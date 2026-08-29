/**
 * createOrder 签名模块 — 自动锁场链路唯一带签名的接口
 *
 * 算法已从小程序包反编译确认（pages/venueReservation/chunk_0.appservice.js）：
 *   stringToSign = timestamp + "\n" + nonce + "\n" + APP_SECRET + "\n"
 *   timestamp    = Unix 秒级时间戳字符串
 *   nonce        = 6~8 位随机小写字母+数字（[a-z0-9]）
 *   APP_SECRET   = 内嵌常量 ade2223c47623d82ecbc413fa5cc6dc1（注意末尾带 \n）
 *   signature    = RSA-2048 SHA256withRSA（PKCS#1 v1.5）签名后 base64
 * 请求体不参与签名。
 *
 * 私钥从 env GYM_SIGN_PRIVATE_KEY 读（PKCS#8 PEM，.env 中用双引号包裹，
 * 换行写 \n，dotenv 会自动还原）；未配置时抛 SignNotConfiguredError，
 * 由上层（bookingLockService / watchEngine）优雅降级。
 */
const crypto = require('crypto');

const APP_SECRET = 'ade2223c47623d82ecbc413fa5cc6dc1';

class SignNotConfiguredError extends Error {
  constructor() {
    super('createOrder 签名私钥未配置（请在服务器 .env 配置 GYM_SIGN_PRIVATE_KEY）');
    this.name = 'SignNotConfiguredError';
  }
}

function loadPrivateKey() {
  const pem = process.env.GYM_SIGN_PRIVATE_KEY;
  if (!pem) return null;
  // 兼容 .env 中写成字面量 \n 的情况
  return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
}

function isSignerConfigured() {
  return !!loadPrivateKey();
}

/** 与小程序一致：6~8 位随机 [a-z0-9] */
function generateNonce() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const len = 6 + crypto.randomInt(3); // 6,7,8
  let nonce = '';
  for (let i = 0; i < len; i++) nonce += chars[crypto.randomInt(chars.length)];
  return nonce;
}

/** 待签名串（已反编译确认，勿改）：timestamp\nnonce\nAPP_SECRET\n */
function buildStringToSign({ timestamp, nonce }) {
  return `${timestamp}\n${nonce}\n${APP_SECRET}\n`;
}

/**
 * 生成 createOrder 的 X-Ca-* 签名头三元组。
 * @returns {{ timestamp: string, nonce: string, signature: string }}
 * @throws {SignNotConfiguredError} 私钥未配置时抛出
 */
function signCreateOrder() {
  const pem = loadPrivateKey();
  if (!pem) throw new SignNotConfiguredError();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = generateNonce();
  const stringToSign = buildStringToSign({ timestamp, nonce });
  // node:crypto 默认 RSA PKCS#1 v1.5 padding，等价 jsrsasign 的 SHA256withRSA
  const signature = crypto.sign('sha256', Buffer.from(stringToSign, 'utf8'), pem).toString('base64');
  return { timestamp, nonce, signature };
}

module.exports = { SignNotConfiguredError, isSignerConfigured, signCreateOrder, buildStringToSign, generateNonce };
