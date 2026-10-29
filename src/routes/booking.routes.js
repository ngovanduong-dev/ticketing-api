const router = require('express').Router();
const ctrl = require('../controllers/booking.controller');
const authenticate = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const { bookingLimiter } = require('../middlewares/rateLimit.middleware');

const idempotencyKey = require('../middlewares/idempotency.middleware');

router.use(authenticate);

router.post('/', bookingLimiter, requireRole('ATTENDEE'), idempotencyKey, ctrl.createBooking);
router.post('/batch', bookingLimiter, requireRole('ATTENDEE'), idempotencyKey, ctrl.createBundle);
router.get('/me', ctrl.getMyBookings);
router.delete('/:id', ctrl.cancelBooking);

module.exports = router;
