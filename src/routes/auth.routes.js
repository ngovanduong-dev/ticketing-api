const router = require('express').Router();
const { register, login, getMe } = require('../controllers/auth.controller');
const authenticate = require('../middlewares/auth.middleware');
const { authLimiter } = require('../middlewares/rateLimit.middleware');

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.get('/me', authenticate, getMe);

module.exports = router;
