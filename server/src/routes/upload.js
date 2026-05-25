const express = require('express');
const router = express.Router();
const { success, validationError } = require('../utils/response');
const { sendControllerError } = require('../utils/errorHandling');
const { avatarFilename } = require('../utils/id');
const path = require('path');
const fs = require('fs');

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const EXT_BY_MIME = {
  jpeg: 'jpg',
  jpg: 'jpg',
  png: 'png',
  webp: 'webp'
};

function hasValidImageSignature(data, ext) {
  if (ext === 'jpg') {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (ext === 'png') {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return data.length >= png.length && data.subarray(0, png.length).equals(png);
  }
  if (ext === 'webp') {
    return data.length >= 12 &&
      data.subarray(0, 4).toString('ascii') === 'RIFF' &&
      data.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

router.post('/avatar', (req, res) => {
  try {
    const { image } = req.body; // base64
    if (!image) return validationError(res, '缺少图片数据');

    const matches = image.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
    if (!matches) return validationError(res, '头像只支持 jpg、png 或 webp');

    const ext = EXT_BY_MIME[matches[1].toLowerCase()];
    const data = Buffer.from(matches[2], 'base64');
    if (data.length === 0) return validationError(res, '图片数据为空');
    if (data.length > MAX_AVATAR_BYTES) return validationError(res, '头像不能超过 2MB');
    if (!hasValidImageSignature(data, ext)) return validationError(res, '图片内容与格式不匹配');

    const filename = avatarFilename(ext);
    const dir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), data);

    success(res, { url: `/uploads/avatars/${filename}` });
  } catch (err) { sendControllerError(res, err, 'uploadRoutes'); }
});

module.exports = router;
