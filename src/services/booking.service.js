const logger = require('../lib/logger');
const AppError = require('../utils/AppError');

async function bookInTransaction(tx, { eventId, quantity, userId }) {
  // Match capacity updates: lock the event first, then read confirmed quantity.
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
        userId,
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

  await tx.event.update({ where: { id: eventId }, data: { version: { increment: 1 } } });
  const totalPrice = Number(event.price) * quantity;

  return tx.booking.create({
    data: { eventId, userId, quantity, totalPrice, status: 'CONFIRMED' },
    include: {
      event: { select: { id: true, title: true, date: true, venue: true, price: true } },
    },
  });
}

module.exports = { bookInTransaction };
