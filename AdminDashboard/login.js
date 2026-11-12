'use strict';

const adminLoginForm = document.getElementById('adminLoginForm');
const loginError = document.getElementById('loginError');

adminLoginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = adminLoginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    loginError.textContent = '';
    try {
        await window.BiteRushApi.request('staff-login', {
            method: 'POST',
            body: {
                username: document.getElementById('adminUsername').value.trim(),
                password: document.getElementById('adminPassword').value
            }
        });
        window.location.href = 'dashboard.html';
    } catch (error) {
        loginError.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});
