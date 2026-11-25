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
                error.status = response.status;
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
    const path = window.location.pathname.replace(/\\/g, '/');
    const isPortalPage = /\/(?:AdminDashboard|Staff|Login)\//i.test(path)
        || /\/(?:AdminDashboard|Staff|Login)\/[^/]+\.html$/i.test(path);
    if (!isPortalPage && !document.querySelector('.biterush-site-footer')) {
        document.body.classList.add('biterush-footer-layout');
        if (![...document.styleSheets].some(sheet => String(sheet.href || '').includes('/Cart/cart.css'))) {
            const footerStyles = document.createElement('link');
            footerStyles.rel = 'stylesheet';
            footerStyles.href = `${projectPath ? projectPath[1] : ''}/Cart/cart.css?v=12`;
            document.head.appendChild(footerStyles);
        }
        const footer = document.createElement('footer');
        footer.className = 'biterush-site-footer';
        const root = projectPath ? projectPath[1] : '';
        footer.innerHTML = `
            <div class="biterush-footer-inner">
                <div class="biterush-footer-main">
                    <div class="biterush-footer-brand-column">
                        <a class="biterush-footer-brand" href="${root}/index.html" aria-label="BiteRush home">
                            <img src="${root}/BiteRushHomePage/HomePagePics/burger.png" alt="">
                            <span>BiteRush</span>
                        </a>
                        <p class="biterush-footer-tagline">Crave it. Order it. Bite it. Fresh BiteRush favorites delivered to you.</p>
                    </div>
                    <div class="biterush-footer-column" role="navigation" aria-label="Menu links">
                        <h2>Menu</h2>
                        <a href="${root}/BiteRushFoodMenuPages/BiteRushBreakfastPage/index.html">Breakfast</a>
                        <a href="${root}/BiteRushFoodMenuPages/BiteRushLunchPage/index.html">Lunch</a>
                        <a href="${root}/BiteRushFoodMenuPages/BiteRushDinnerPage/index.html">Dinner</a>
                        <a href="${root}/BiteRushFoodMenuPages/BiteRushBGandFR/index.html">Burger and Fries</a>
                    </div>
                    <div class="biterush-footer-column" role="navigation" aria-label="Account links">
                        <h2>Your account</h2>
                        <a href="${root}/FavPage/index.html">Favorites</a>
                        <a href="${root}/TrackOrder/index.html">Track order</a>
                        <a href="${root}/UserInfo/index.html">Profile</a>
                    </div>
                    <div class="biterush-footer-column" role="navigation" aria-label="Support links">
                        <h2>Support</h2>
                        <a href="${root}/FeedbackHistory/index.html">Feedback history</a>
                        <a href="${root}/DeliveryAddress/terms.html">Terms and privacy</a>
                        <a href="${root}/OrderHistory/index.html">Order history</a>
                    </div>
                </div>
                <div class="biterush-footer-bottom">
                    <span>&copy; ${new Date().getFullYear()} BiteRush. All rights reserved.</span>
                    <span>Made for good cravings.</span>
                </div>
            </div>`;
        document.body.appendChild(footer);
    }
    const adminDashboard = /\/AdminDashboard\/dashboard\.html$/i.test(window.location.pathname);
    const staffDashboard = /\/Staff\/dashboard\.html$/i.test(window.location.pathname);
    let sessionRefreshInProgress = false;
    let orderStatusRefreshInProgress = false;
    let orderFeedbackTimer;
    const orderStatusCacheKey = userId => `biterush_order_status_${userId}`;
    const orderStatusLabels = {
        received: 'received',
        preparing: 'being prepared',
        on_the_way: 'on the way',
        delivered: 'delivered',
        cancelled: 'cancelled'
    };
    const notifyOrderStatus = message => {
        if (typeof window.BiteRushCart?.notify === 'function') {
            window.BiteRushCart.notify(message);
            return;
        }

        let feedback = document.querySelector('.biterush-order-feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.className = 'shared-cart-feedback biterush-order-feedback';
            feedback.setAttribute('role', 'status');
            feedback.setAttribute('aria-live', 'polite');
            feedback.setAttribute('aria-atomic', 'true');
            feedback.hidden = true;
            document.body.appendChild(feedback);
        }
        feedback.textContent = message;
        feedback.hidden = false;
        feedback.classList.add('is-visible');
        window.clearTimeout(orderFeedbackTimer);
        orderFeedbackTimer = window.setTimeout(() => {
            feedback.classList.remove('is-visible');
            orderFeedbackTimer = window.setTimeout(() => {
                if (!feedback.classList.contains('is-visible')) feedback.hidden = true;
            }, 200);
        }, 5000);
    };
    const refreshDatabaseSession = async () => {
        if (sessionRefreshInProgress || document.visibilityState === 'hidden') return;
        sessionRefreshInProgress = true;
        try {
            if (!adminDashboard && !staffDashboard && accountId) {
                try {
                    const { user } = await window.BiteRushApi.request('me');
                    const changed = window.BiteRushApi.setAccountContext(user);
                    const cacheKeys = [
                        ['username', user.username],
                        ['fullname', user.fullname],
                        ['email', user.email]
                    ];
                    const profileChanged = cacheKeys.some(([key, value]) =>
                        localStorage.getItem(key) !== null && localStorage.getItem(key) !== value
                    );
                    cacheKeys.forEach(([key, value]) => localStorage.setItem(key, value));
                    if (user.profileImage) {
                        localStorage.setItem('biterush_profile_image', user.profileImage);
                    } else {
                        localStorage.removeItem('biterush_profile_image');
                    }
                    document.querySelectorAll(
                        'a[href*="UserInfo"] img, .history-profile img, .profile-link img, .user-profile img'
                    ).forEach(img => {
                        img.src = user.profileImage
                            || "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'%3E%3Crect width='160' height='160' rx='80' fill='%23f5c430'/%3E%3Ccircle cx='80' cy='62' r='26' fill='%23ffffff'/%3E%3Cpath d='M43 122c8-20 27-32 37-32s29 12 37 32' fill='%23ffffff'/%3E%3C/svg%3E";
                    });
                    if (changed || profileChanged) {
                        window.location.reload();
                        return;
                    }
                } catch (error) {
                    if (error.status === 401) {
                        window.BiteRushApi.clearAccountContext();
                        window.location.reload();
                        return;
                    }
                    console.error('Unable to refresh the customer session:', error);
                }
            }

            if (adminDashboard || staffDashboard) {
                try {
                    const { staff } = await window.BiteRushApi.request('staff-session');
                    if (adminDashboard && staff.role !== 'admin') {
                        window.location.replace('../Staff/dashboard.html');
                    }
                } catch (error) {
                    if (error.status === 401 || error.status === 403) {
                        window.location.replace(adminDashboard ? 'login.html' : 'index.html');
                        return;
                    }
                    console.error('Unable to refresh the staff session:', error);
                }
            }
        } finally {
            sessionRefreshInProgress = false;
        }
    };
    const refreshOrderStatusNotifications = async () => {
        if (!accountId || adminDashboard || staffDashboard || orderStatusRefreshInProgress
            || document.visibilityState === 'hidden') return;
        orderStatusRefreshInProgress = true;
        const userId = accountId;
        try {
            const result = await window.BiteRushApi.request('order-updates');
            if (!Array.isArray(result.orders)) {
                throw new Error('The order status response is invalid.');
            }

            const storageKey = orderStatusCacheKey(userId);
            let previousStatuses = {};
            let hasSnapshot = false;
            try {
                const snapshot = JSON.parse(localStorage.getItem(storageKey) || 'null');
                if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
                    previousStatuses = snapshot;
                    hasSnapshot = true;
                }
            } catch (error) {
                console.error('Unable to read saved order status notifications:', error);
            }
            if (!hasSnapshot) {
                try {
                    const cachedOrders = JSON.parse(localStorage.getItem('biterush_orders') || '[]');
                    if (Array.isArray(cachedOrders)) {
                        cachedOrders.forEach(order => {
                            if (order && order.id && typeof order.status === 'string') {
                                previousStatuses[String(order.id)] = order.status;
                            }
                        });
                    }
                } catch (error) {
                    console.error('Unable to read cached order statuses:', error);
                }
            }

            const nextStatuses = {};
            const changedOrders = [];
            result.orders.forEach(order => {
                if (!order || typeof order.id !== 'string' || typeof order.status !== 'string') return;
                nextStatuses[order.id] = order.status;
                if (previousStatuses[order.id] && previousStatuses[order.id] !== order.status) {
                    changedOrders.push(order);
                }
            });
            localStorage.setItem(storageKey, JSON.stringify(nextStatuses));
            if (userId !== accountId || !changedOrders.length) return;

            const updates = changedOrders.slice(0, 3).map(order =>
                `#${order.id} is now ${orderStatusLabels[order.status] || order.status}`
            );
            if (changedOrders.length > updates.length) {
                updates.push(`and ${changedOrders.length - updates.length} more`);
            }
            notifyOrderStatus(`Order update: ${updates.join('; ')}.`);
        } catch (error) {
            if (error.status !== 401) {
                console.error('Unable to check for order status updates:', error);
            }
        } finally {
            orderStatusRefreshInProgress = false;
        }
    };
    window.addEventListener('focus', refreshDatabaseSession);
    document.addEventListener('visibilitychange', refreshDatabaseSession);
    window.setInterval(refreshDatabaseSession, 30000);
    refreshDatabaseSession();
    window.addEventListener('focus', refreshOrderStatusNotifications);
    document.addEventListener('visibilitychange', refreshOrderStatusNotifications);
    window.setInterval(refreshOrderStatusNotifications, 30000);
    refreshOrderStatusNotifications();
}());
