const { prisma } = require('./utils/prisma');

module.exports = async () => {
  await prisma.$disconnect();
};
