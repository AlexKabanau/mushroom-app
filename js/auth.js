// Simple password gate (SHA-256 hash of password stored in config.js)
// Note: Since source is public, this is a soft gate — not a security measure
// against determined attackers. Real security is the Gist token privacy.
import { CONFIG } from './config.js';

const AUTH_KEY = 'mushroom-auth';

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function requireAuth() {
  const stored = localStorage.getItem(AUTH_KEY);
  if (stored && stored === CONFIG.passwordHash) return true;

  // Show password modal
  return await new Promise(resolve => {
    const html = `
      <div id="auth-overlay" style="position:fixed;inset:0;background:#FAF6EC;display:flex;align-items:center;justify-content:center;z-index:9999;font-family:system-ui">
        <div style="background:white;padding:40px;border-radius:12px;max-width:360px;width:90%;border:1px solid #E6DECC">
          <h1 style="font-family:Georgia,serif;margin:0 0 8px 0;font-weight:400;font-size:24px">🍄 Грибной светофор</h1>
          <p style="margin:0 0 20px 0;color:#6B5F52;font-size:14px">Приложение приватное. Введите пароль.</p>
          <input id="auth-pass" type="password" placeholder="Пароль" autofocus style="width:100%;padding:10px 14px;font-size:15px;border:1px solid #E6DECC;border-radius:6px;outline:none;margin-bottom:12px;box-sizing:border-box">
          <div id="auth-err" style="color:#B45441;font-size:13px;margin-bottom:12px;min-height:16px"></div>
          <button id="auth-btn" style="width:100%;padding:10px;background:#B45441;color:white;border:none;border-radius:6px;font-size:15px;font-weight:500;cursor:pointer">Войти</button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    const inp = document.getElementById('auth-pass');
    const btn = document.getElementById('auth-btn');
    const err = document.getElementById('auth-err');

    const attempt = async () => {
      err.textContent = '';
      const hash = await sha256Hex(inp.value);
      if (hash === CONFIG.passwordHash) {
        localStorage.setItem(AUTH_KEY, hash);
        document.getElementById('auth-overlay').remove();
        resolve(true);
      } else {
        err.textContent = 'Неверный пароль';
        inp.value = '';
        inp.focus();
      }
    };
    btn.addEventListener('click', attempt);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  });
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
  location.reload();
}

// Expose a helper for setting a new password hash from the console
window.setPasswordHash = async (newPassword) => {
  const hash = await sha256Hex(newPassword);
  console.log('Set this in js/config.js as passwordHash:');
  console.log(hash);
  return hash;
};
