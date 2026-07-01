const { z } = require('zod');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const AppError = require('../utils/AppError');
const { catchAsync } = require('../middlewares/error.middleware');

const createBookingSchema = z.object({
  eventId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
});

const createBooking = catchAsync(async (req, res) => {
  const { eventId, quantity } = createBookingSchema.parse(req.body);

  const booking = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT "id", "title", "date", "venue", "capacity", "price", "status"
      FROM "events"
      WHERE "id" = ${eventId}
      FOR UPDATE
    `;

    if (rows.length === 0) throw new AppError('Event not found', 404);

    const event = rows[0];
    if (event.status !== 'PUBLISHED') throw new AppError('Event is not available for booking', 400);
    if (new Date(event.date) <= new Date()) throw new AppError('Event has already passed', 400);

    const bookedResult = await tx.booking.aggregate({
      where: { eventId, status: 'CONFIRMED' },
      _sum: { quantity: true },
    });
    const totalBooked = bookedResult._sum.quantity ?? 0;
    const available = Number(event.capacity) - totalBooked;

    if (quantity > available) {
      logger.warn(
        {
          eventId,
          userId: req.user.id,
          requestedQuantity: quantity,
          available,
          totalBooked,
        },
        'Booking rejected because event capacity is insufficient'
      );

      throw new AppError(
        available === 0 ? 'Event is sold out' : `Only ${available} tickets available`,
        409
      );
    }

    const totalPrice = Number(event.price) * quantity;

    return tx.booking.create({
      data: { eventId, userId: req.user.id, quantity, totalPrice, status: 'CONFIRMED' },
      include: {
        event: { select: { id: true, title: true, date: true, venue: true, price: true } },
      },
    });
  });

  logger.info(
    {
      bookingId: booking.id,
      eventId,
      userId: req.user.id,
      quantity,
    },
    'Booking created'
  );

  res.status(201).json({ status: 'success', data: { booking } });
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
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
    include: { event: { select: { date: true, title: true } } },
  });

  if (!booking) throw new AppError('Booking not found', 404);
  if (booking.userId !== req.user.id) throw new AppError('Forbidden', 403);
  if (booking.status === 'CANCELLED') throw new AppError('Booking is already cancelled', 400);
  if (new Date(booking.event.date) <= new Date()) {
    throw new AppError('Cannot cancel booking for past events', 400);
  }

  const updated = await prisma.booking.update({
    where: { id: req.params.id },
    data: { status: 'CANCELLED' },
    include: {
      event: { select: { id: true, title: true, date: true } },
    },
  });

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

module.exports = { createBooking, getMyBookings, cancelBooking };
