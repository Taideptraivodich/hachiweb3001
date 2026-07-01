// Dùng để tạo ADMIN_PASSWORD_HASH cho file .env
// Cách chạy: node scripts/hash-password.js "mat_khau_cua_ban"
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.log('Dùng: node scripts/hash-password.js "mật khẩu"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log('\nDán dòng dưới vào file .env:\n');
console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
