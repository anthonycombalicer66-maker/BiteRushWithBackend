(function () {
    'use strict';

    const projectPath = window.location.pathname.match(/^(.*?\/BiteRush)(?:\/|$)/i);
    const apiUrl = `${projectPath ? projectPath[1] : ''}/api/index.php`;
    const activeAccountKey = 'biterush_active_user_id';
    const accountDataKeys = [
        'biterush_cart',
        'biterush_voucher',
        'biterush_delivery',
        'biterush_saved_tip',
        'biterush_last_order',
        'biterush_orders',
        'biterush_checkout_request',
        'username',
        'fullname',
        'email',
        'biterush_profile_image'
    ];
    const getUserFavoritesStorageKey = userId => {
        const resolvedUserId = Number(userId ?? localStorage.getItem(activeAccountKey));
        return Number.isSafeInteger(resolvedUserId) && resolvedUserId > 0
            ? `biterush_favorites_${resolvedUserId}`
            : 'biterush_favorites_guest';
    };
    const clearAccountData = () => {
        accountDataKeys.forEach(key => localStorage.removeItem(key));
        sessionStorage.removeItem('biterush_single_checkout_keys');
    };
    let accountId = localStorage.getItem(activeAccountKey);

    window.addEventListener('storage', event => {
        if (event.key === activeAccountKey && event.newValue !== accountId) {
            clearAccountData();
            accountId = event.newValue;
            window.location.reload();
        }
    });

    window.BiteRushApi = {
        getFavoritesStorageKey() {
            return getUserFavoritesStorageKey(accountId);
        },
        setAccountContext(user) {
            const userId = Number(user && user.id);
            if (!Number.isSafeInteger(userId) || userId < 1) {
                throw new Error('The account session is invalid.');
            }
            const id = String(userId);
            const changed = localStorage.getItem(activeAccountKey) !== id || accountId !== id;
            if (changed) clearAccountData();
            accountId = id;
            localStorage.setItem(activeAccountKey, id);
            return changed;
        },
        clearAccountContext() {
            clearAccountData();
            accountId = null;
            localStorage.removeItem(activeAccountKey);
        },
        accountHeaders() {
            return accountId ? { 'X-BiteRush-Account': accountId } : {};
        },
        async ensureAccountContext(action, method) {
            const requiresContext = action === 'favorites'
                    && ['POST', 'PUT', 'DELETE'].includes(method)
                || action === 'cart' && method === 'PUT'
                || action === 'profile' && method === 'PATCH'
                || action === 'account' && method === 'DELETE'
                || action === 'logout' && method === 'POST'
                || action === 'orders' && method === 'POST'
                || action === 'confirm-delivery' && method === 'POST'
                || action === 'feedback' && method === 'POST';
            if (!requiresContext || accountId) return;

            const response = await fetch(`${apiUrl}?action=me`, { credentials: 'same-origin' });
            let result;
            try {
                result = await response.json();
            } catch (error) {
                throw new Error('The server returned an invalid account response.');
            }
            if (!response.ok || !result.user) {
                throw new Error(result.error || `Request failed (${response.status}).`);
            }
            this.setAccountContext(result.user);
        },
        async request(action, options = {}) {
            const query = new URLSearchParams({ action });
            Object.entries(options.query || {}).forEach(([key, value]) => {
                query.set(key, String(value));
            });
            const method = options.method || 'GET';
            await this.ensureAccountContext(action, method);
            const headers = options.body === undefined ? {} : { 'Content-Type': 'application/json' };
            if (accountId && !['login', 'signup', 'me'].includes(action)) {
                headers['X-BiteRush-Account'] = accountId;
            }
            const response = await fetch(`${apiUrl}?${query.toString()}`, {
                method,
                credentials: 'same-origin',
                headers,
                body: options.body === undefined ? undefined : JSON.stringify(options.body)
            });
            let result;
            try {
                result = await response.json();
            } catch (error) {
                throw new Error('The server returned an invalid response.');
            }
            if (!response.ok) {
                const error = new Error(result.error || `Request failed (${response.status}).`);
                error.code = result.code || '';
                if (error.code === 'account_context_changed') {
                    try {
                        const { user } = await this.request('me');
                        if (this.setAccountContext(user)) window.location.reload();
                    } catch (recoveryError) {
                        console.error('Unable to recover the active account context:', recoveryError);
                    }
                }
                throw error;
            }
            return result;
        }
    };
}());
