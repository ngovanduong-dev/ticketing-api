const request = require('supertest');
const app = require('../src/app');
const { createTestUser, createTestCategory, createTestEvent } = require('./helpers');

describe('categories integration', () => {
  it('lists categories with published event counts', async () => {
    const { user: organizer } = await createTestUser('ORGANIZER');
    const category = await createTestCategory();

    await createTestEvent(organizer.id, category.id, { status: 'PUBLISHED' });
    await createTestEvent(organizer.id, category.id, { status: 'CANCELLED' });

    const res = await request(app).get('/api/v1/categories');

    expect(res.status).toBe(200);

    const returnedCategory = res.body.data.categories.find((item) => item.id === category.id);
    expect(returnedCategory).toMatchObject({
      id: category.id,
      name: category.name,
      slug: category.slug,
    });
    expect(returnedCategory._count.events).toBe(1);
  });
});
