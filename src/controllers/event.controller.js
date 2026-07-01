const { z } = require('zod');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const AppError = require('../utils/AppError');
const { catchAsync } = require('../middlewares/error.middleware');

const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  date: z.string().datetime({ message: 'Invalid date format.' }),
  venue: z.string().min(1).max(300),
  capacity: z.number().int().positive(),
  price: z.number().min(0),
  categoryId: z.string().uuid(),
});

const updateEventSchema = createEventSchema.partial();

const listEventsQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  from: z.string().datetime({ message: 'Invalid from date format.' }).optional(),
  to: z.string().datetime({ message: 'Invalid to date format.' }).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const listEvents = catchAsync(async (req, res) => {
  const { categoryId, from, to, q, page, limit } = listEventsQuerySchema.parse(req.query);

  const skip = (page - 1) * limit;

  const where = {
    status: 'PUBLISHED',
    ...(categoryId && { categoryId }),
    ...(q && { title: { contains: q, mode: 'insensitive' } }),
    ...((from || to) && {
      date: {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      },
    }),
  };

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      select: {
        id: true,
        title: true,
        date: true,
        venue: true,
        capacity: true,
        price: true,
        status: true,
        createdAt: true,
        category: { select: { id: true, name: true, slug: true } },
        organizer: { select: { id: true, name: true } },
        _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
      },
      orderBy: { date: 'asc' },
      skip,
      take: limit,
    }),
    prisma.event.count({ where }),
  ]);

  res.json({
    status: 'success',
    data: {
      events,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

const getEvent = catchAsync(async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    include: {
      category: true,
      organizer: { select: { id: true, name: true } },
      _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
    },
  });

  if (!event) throw new AppError('Event not found', 404);

  res.json({ status: 'success', data: { event } });
});

const createEvent = catchAsync(async (req, res) => {
  const data = createEventSchema.parse(req.body);

  if (new Date(data.date) <= new Date()) {
    throw new AppError('Event date must be in the future', 400);
  }

  const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
  if (!category) throw new AppError('Category not found', 404);

  const event = await prisma.event.create({
    data: { ...data, price: data.price, organizerId: req.user.id },
    include: { category: true, organizer: { select: { id: true, name: true } } },
  });

  logger.info(
    {
      eventId: event.id,
      organizerId: req.user.id,
      categoryId: event.categoryId,
    },
    'Event created'
  );

  res.status(201).json({ status: 'success', data: { event } });
});

const updateEvent = catchAsync(async (req, res) => {
  const event = await prisma.event.findUnique({ where: { id: req.params.id } });
  if (!event) throw new AppError('Event not found', 404);
  if (event.organizerId !== req.user.id) throw new AppError('You can only edit your own events', 403);
  if (event.status === 'CANCELLED') throw new AppError('Cannot edit a cancelled event', 400);

  const data = updateEventSchema.parse(req.body);

  if (data.date && new Date(data.date) <= new Date()) {
    throw new AppError('Event date must be in the future', 400);
  }

  if (data.categoryId) {
    const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!category) throw new AppError('Category not found', 404);
  }

  const updated = await prisma.event.update({
    where: { id: req.params.id },
    data,
    include: { category: true },
  });

  logger.info(
    {
      eventId: updated.id,
      organizerId: req.user.id,
      updatedFields: Object.keys(data),
    },
    'Event updated'
  );

  res.json({ status: 'success', data: { event: updated } });
});

const deleteEvent = catchAsync(async (req, res) => {
  const event = await prisma.event.findUnique({ where: { id: req.params.id } });
  if (!event) throw new AppError('Event not found', 404);
  if (event.organizerId !== req.user.id) throw new AppError('You can only delete your own events', 403);

  await prisma.event.update({
    where: { id: req.params.id },
    data: { status: 'CANCELLED' },
  });

  logger.info(
    {
      eventId: req.params.id,
      organizerId: req.user.id,
    },
    'Event cancelled'
  );

  res.status(204).send();
});

module.exports = { listEvents, getEvent, createEvent, updateEvent, deleteEvent };
