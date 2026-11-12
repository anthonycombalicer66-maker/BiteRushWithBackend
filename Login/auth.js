(function () {
  'use strict';

  function setMessage(id, text) {
    const message = document.getElementById(id);
    if (!message) return;
    message.textContent = text;
    message.hidden = !text;
  }

  function showStorageError(id, error) {
    setMessage(id, error && error.message
      ? error.message
      : 'The server could not complete your request. Check that Apache and MySQL are running.');
  }

  function startSession(user) {
    window.BiteRushApi.setAccountContext(user);
    localStorage.setItem('username', user.username);
    localStorage.setItem('fullname', user.fullname);
    localStorage.setItem('email', user.email);
    if (user.profileImage) {
      localStorage.setItem('biterush_profile_image', user.profileImage);
    } else {
      localStorage.removeItem('biterush_profile_image');
    }
  }

  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      setMessage('auth-message', '');
      const button = loginForm.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const result = await window.BiteRushApi.request('login', {
          method: 'POST',
          body: {
            identity: document.getElementById('login-identity').value.trim(),
            password: document.getElementById('login-password').value
          }
        });
        startSession(result.user);
        window.location.href = '../BiteRushHomePage/index.html';
      } catch (error) {
        showStorageError('auth-message', error);
      } finally {
        button.disabled = false;
      }
    });
  }

  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    const password = document.getElementById('signup-password');
    const confirmation = document.getElementById('signup-confirm-password');
    const updateConfirmationValidity = () => {
      confirmation.setCustomValidity(
        confirmation.value && confirmation.value !== password.value
          ? 'Passwords do not match.'
          : ''
      );
    };
    password.addEventListener('input', updateConfirmationValidity);
    confirmation.addEventListener('input', updateConfirmationValidity);

    signupForm.addEventListener('submit', async event => {
      event.preventDefault();
      setMessage('signup-message', '');
      updateConfirmationValidity();
      if (!signupForm.reportValidity()) return;

      const button = signupForm.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const result = await window.BiteRushApi.request('signup', {
          method: 'POST',
          body: {
            fullname: document.getElementById('signup-name').value.trim(),
            username: document.getElementById('signup-username').value.trim(),
            email: document.getElementById('signup-email').value.trim(),
            password: password.value
          }
        });
        startSession(result.user);
        window.location.href = '../BiteRushHomePage/index.html';
      } catch (error) {
        showStorageError('signup-message', error);
      } finally {
        button.disabled = false;
      }
    });
  }

  const toggle = document.querySelector('.toggle-password');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const input = document.getElementById('login-password');
      const icon = toggle.querySelector('i');
      if (!input || !icon) return;
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      icon.classList.toggle('fa-eye', visible);
      icon.classList.toggle('fa-eye-slash', !visible);
      toggle.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
    });
  }
}());
