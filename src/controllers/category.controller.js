const prisma = require('../lib/prisma');
const { catchAsync } = require('../middlewares/error.middleware');

const listCategories = catchAsync(async (req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: {
          events: { where: { status: 'PUBLISHED' } },
        },
      },
    },
  });

  res.json({ status: 'success', data: { categories } });
});

module.exports = { listCategories };
