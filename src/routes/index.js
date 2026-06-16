const router = require('express').Router();

router.get('/', (req, res) => {
  res.json({
    message: "Welcome to the Event Ticketing API",
    version: "v1.0.0",
    documentation: "https://github.com/ngovanduong-dev/ticketing-api#readme"
  });
});

router.use('/auth', require('./auth.routes'));
router.use('/events', require('./event.routes'));
router.use('/bookings', require('./booking.routes'));
router.use('/categories', require('./category.routes'));

module.exports = router;
