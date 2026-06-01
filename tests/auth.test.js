const request = require('supertest');
const app = require('../src/app');
const { uniqueTestEmail } = require('./helpers');

describe('auth integration', () => {
  it('registers a new attendee', async () => {
    const email = uniqueTestEmail('auth-register');

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'password123',
        name: 'Auth Test User',
        role: 'ATTENDEE',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({
      email,
      name: 'Auth Test User',
      role: 'ATTENDEE',
    });
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('rejects duplicate email registration', async () => {
    const email = uniqueTestEmail('auth-duplicate');
    const payload = {
      email,
      password: 'password123',
      name: 'Duplicate User',
      role: 'ATTENDEE',
    };

    await request(app).post('/api/v1/auth/register').send(payload);
    const res = await request(app).post('/api/v1/auth/register').send(payload);

    expect(res.status).toBe(409);
  });

  it('logs in with valid credentials', async () => {
    const email = uniqueTestEmail('auth-login');
    const password = 'password123';

    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password, name: 'Login User', role: 'ATTENDEE' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('rejects invalid login credentials', async () => {
    const email = uniqueTestEmail('auth-invalid');

    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'password123',
        name: 'Invalid Login User',
        role: 'ATTENDEE',
      });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('rejects /me without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');

    expect(res.status).toBe(401);
  });
});
