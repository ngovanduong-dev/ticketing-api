const { z } = require('zod');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const AppError = require('../utils/AppError');
const { catchAsync } = require('../middlewares/error.middleware');

const { bookInTransaction } = require('../services/booking.service');
const { executeWithIdempotency } = require('../services/idempotency.service');
const { bookBundleInTransaction, transactionOptions, bundleSchema } = require('../services/concurrencyStrategies.service');

async function executeBooking(req, res, endpoint, handler) {
  let result;
  if (req.idempotencyKey) {
    result = await executeWithIdempotency({
      prisma, idempotencyKey: req.idempotencyKey, userId: req.user.id,
      endpoint, requestBody: req.body, handler,
    });
    res.set('Idempotency-Replayed', String(result.replayed));
  } else {
    result = await prisma.$transaction(handler, transactionOptions);
  }
  if (result.statusCode === 201 && !result.replayed) {
    const bookings = result.body.data.bookings ?? [result.body.data.booking];
    for (const booking of bookings) {
      logger.info({ bookingId: booking.id, eventId: booking.eventId, userId: req.user.id, quantity: booking.quantity }, 'Booking created');
    }
  }
  return res.status(result.statusCode).json(result.body);
}

const createBookingSchema = z.object({
  eventId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
});

const createBooking = catchAsync(async (req, res) => {
  const { eventId, quantity } = createBookingSchema.parse(req.body);

  return executeBooking(req, res, 'POST /api/v1/bookings', async (tx) => {
    const booking = await bookInTransaction(tx, { eventId, quantity, userId: req.user.id });
    return { statusCode: 201, body: { status: 'success', data: { booking } } };
  });
});

const createBundle = catchAsync(async (req, res) => {
  const items = bundleSchema.parse(req.body?.items);
  return executeBooking(req, res, 'POST /api/v1/bookings/batch', async (tx) => {
    const result = await bookBundleInTransaction(tx, { userId: req.user.id, items });
    if (result.status !== 'SUCCESS') {
      const errors = {
        NOT_FOUND: [404, 'Event not found'],
        INVALID_EVENT: [400, 'Event is not available for booking'],
        INSUFFICIENT_TICKETS: [409, 'Insufficient tickets for bundle'],
      };
      const [status, message] = errors[result.status];
      throw new AppError(message, status);
    }
    return { statusCode: 201, body: { status: 'success', data: { bookings: result.bookings } } };
  });
});

const getMyBookings = catchAsync(async (req, res) => {
  const bookings = await prisma.booking.findMany({
    where: { userId: req.user.id },
    include: {
      event: { select: { id: true, title: true, date: true, venue: true, price: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ status: 'success', data: { bookings } });
});

const cancelBooking = catchAsync(async (req, res) => {
  const updated = await prisma.$transaction(async (tx) => {
    const snapshot = await tx.booking.findUnique({ where: { id: req.params.id } });
    if (!snapshot) throw new AppError('Booking not found', 404);
    await tx.$queryRaw`SELECT id FROM events WHERE id = ${snapshot.eventId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({
      where: { id: req.params.id },
      include: { event: { select: { date: true, title: true } } },
    });

    if (!booking) throw new AppError('Booking not found', 404);
    if (booking.userId !== req.user.id) throw new AppError('Forbidden', 403);
    if (booking.status === 'CANCELLED') throw new AppError('Booking is already cancelled', 400);
    if (new Date(booking.event.date) <= new Date()) {
      throw new AppError('Cannot cancel booking for past events', 400);
    }

    await tx.event.update({ where: { id: booking.eventId }, data: { version: { increment: 1 } } });
    return tx.booking.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED' },
      include: {
        event: { select: { id: true, title: true, date: true } },
      },
    });
  }, transactionOptions);

  logger.info(
    {
      bookingId: updated.id,
      eventId: updated.eventId,
      userId: req.user.id,
    },
    'Booking cancelled'
  );

  res.json({ status: 'success', data: { booking: updated } });
});

module.exports = { createBundle, createBooking, getMyBookings, cancelBooking };
