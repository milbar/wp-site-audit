const form = document.getElementById('loginForm'), err = document.getElementById('lerr'), btn = document.getElementById('lbtn');
form.addEventListener('submit', async e => {
  e.preventDefault(); err.textContent = ''; btn.disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('lname').value, password: document.getElementById('lpass').value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'A belépés nem sikerült.');
    location.href = '/';
  } catch (ex) { err.textContent = ex.message; btn.disabled = false; document.getElementById('lpass').select(); }
});
