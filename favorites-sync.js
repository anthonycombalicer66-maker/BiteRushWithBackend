(function () {
    'use strict';

    const projectPath = window.location.pathname.match(/^(.*?\/BiteRush)(?:\/|$)/i);
    const endpoint = `${projectPath ? projectPath[1] : ''}/api/index.php`;
    const getStorageKey = () => {
        if (window.BiteRushApi && typeof window.BiteRushApi.getFavoritesStorageKey === 'function') {
            return window.BiteRushApi.getFavoritesStorageKey();
        }
        const activeUserId = localStorage.getItem('biterush_active_user_id');
        return activeUserId ? `biterush_favorites_${activeUserId}` : 'biterush_favorites_guest';
    };
    const buttons = () => [...document.querySelectorAll('.favorite-btn, .search-result-favorite')];
    let serverFavorites = [];
    let authenticated = false;
    let ready = false;
    let syncQueue = Promise.resolve();

    const normalizeTitle = value => String(value || '').trim().toLocaleLowerCase();

    function readLocalFavorites() {
        const storageKey = getStorageKey();
        try {
            const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
            return Array.isArray(value) ? value.filter(item => item && item.title) : [];
        } catch (error) {
            console.error('Unable to read saved favorites:', error);
            return [];
        }
    }

    function favoriteFromServer(item) {
        return {
            title: item.title,
            img: item.img || '',
            link: item.path || '',
            price: Number(item.price),
            category: item.category || '',
            desc: item.description || '',
            productId: Number(item.productId)
        };
    }

    function writeFavorites(favorites) {
        const storageKey = getStorageKey();
        try {
            localStorage.setItem(storageKey, JSON.stringify(favorites));
            return true;
        } catch (error) {
            console.error('Unable to update the favorites cache:', error);
            return false;
        }
    }

    function cardFor(button) {
        return button.closest('.food-card, .search-result-card');
    }

    function titleFor(button) {
        const card = cardFor(button);
        return String(
            card?.dataset.title
            || card?.querySelector('.food-title, .item-title, h2, h3')?.textContent
            || ''
        ).trim();
    }

    function favoriteForButton(button) {
        const card = cardFor(button);
        const local = readLocalFavorites().find(item =>
            normalizeTitle(item.title) === normalizeTitle(titleFor(button))
        );
        const image = card?.querySelector('img')?.src || local?.img || '';
        const link = card?.dataset.link
            || card?.querySelector('.buy-btn, .search-result-buy')?.closest('a')?.getAttribute('href')
            || local?.link
            || '';
        return {
            title: titleFor(button),
            img: image,
            path: link,
            productId: card?.dataset.productId ? Number(card.dataset.productId) : undefined
        };
    }

    function updateButtons(favorites) {
        const titles = new Set(favorites.map(item => normalizeTitle(item.title)));
        buttons().forEach(button => {
            const title = titleFor(button);
            const active = titles.has(normalizeTitle(title));
            button.classList.toggle('favorited', active);
            button.setAttribute('aria-pressed', String(active));
            button.setAttribute(
                'aria-label',
                `${active ? 'Remove' : 'Add'} ${title} ${active ? 'from' : 'to'} favorites`
            );
            const icon = button.querySelector('svg');
            if (icon) icon.style.fill = active ? '#ff3b5c' : '';
            if (button.classList.contains('favorite-btn')) {
                button.style.color = active ? '#ff3b5c' : '';
            }
        });
        document.querySelectorAll('.menu-fav-badge, #favBadge').forEach(badge => {
            badge.textContent = String(favorites.length);
        });
    }

    function showStatus(message) {
        let status = document.getElementById('favoriteSyncStatus');
        if (!status) {
            status = document.createElement('p');
            status.id = 'favoriteSyncStatus';
            status.setAttribute('role', 'status');
            status.className = 'favorites-auth-notice';
            const main = document.querySelector('main');
            if (main) main.prepend(status);
            else document.body.prepend(status);
        }
        status.textContent = message;
        status.hidden = !message;
    }

    async function loadServerFavorites() {
        const { user } = await window.BiteRushApi.request('me');
        window.BiteRushApi.setAccountContext(user);
        let result = await window.BiteRushApi.request('favorites');
        if (!Array.isArray(result.favorites)) {
            throw new Error('The saved favorites response is invalid.');
        }
        if (result.favorites.length === 0) {
            const localFavorites = readLocalFavorites();
            if (localFavorites.length > 0) {
                await window.BiteRushApi.request('favorites', {
                    method: 'PUT',
                    body: {
                        favorites: localFavorites.map(item => ({
                            title: item.title,
                            img: item.img || '',
                            path: item.link || item.path || ''
                        }))
                    }
                });
                result = await window.BiteRushApi.request('favorites');
                if (!Array.isArray(result.favorites)) {
                    throw new Error('The saved favorites response is invalid.');
                }
            }
        }
        serverFavorites = result.favorites.map(favoriteFromServer);
        authenticated = true;
        if (!writeFavorites(serverFavorites)) {
            showStatus('Favorites loaded, but this browser could not update its local display cache.');
        } else {
            showStatus('');
        }
        updateButtons(serverFavorites);
        ready = true;
        buttons().forEach(button => { button.disabled = false; });
    }

    async function initialize() {
        buttons().forEach(button => { button.disabled = true; });
        try {
            await loadServerFavorites();
        } catch (error) {
            if (error.message === 'Please sign in to continue.') {
                if (localStorage.getItem('biterush_active_user_id')) {
                    window.BiteRushApi.clearAccountContext();
                } else {
                    localStorage.removeItem(getStorageKey());
                }
                serverFavorites = [];
                authenticated = false;
                updateButtons([]);
                ready = true;
                buttons().forEach(button => { button.disabled = false; });
                return;
            }
            console.error('Unable to load favorites from the database:', error);
            showStatus(`Favorites could not be loaded from your account: ${error.message}`);
        }
    }

    document.addEventListener('click', event => {
        const button = event.target.closest('.favorite-btn, .search-result-favorite');
        if (!button || !ready) return;

        window.setTimeout(() => {
            const favorite = favoriteForButton(button);
            const requestedAdd = readLocalFavorites().some(item =>
                normalizeTitle(item.title) === normalizeTitle(favorite.title)
            );
            syncQueue = syncQueue.then(async () => {
                if (!authenticated) {
                    showStatus('Sign in to save favorites to your account.');
                    return;
                }
                const exists = serverFavorites.some(item =>
                    normalizeTitle(item.title) === normalizeTitle(favorite.title)
                );
                if (exists === requestedAdd) return;

                try {
                    await window.BiteRushApi.request('favorites', {
                        method: requestedAdd ? 'POST' : 'DELETE',
                        body: favorite
                    });
                    const result = await window.BiteRushApi.request('favorites');
                    if (!Array.isArray(result.favorites)) {
                        throw new Error('The saved favorites response is invalid.');
                    }
                    serverFavorites = result.favorites.map(favoriteFromServer);
                    writeFavorites(serverFavorites);
                    updateButtons(serverFavorites);
                    showStatus('');
                } catch (error) {
                    if (error.code === 'account_context_changed') return;
                    console.error('Unable to save favorite to the database:', error);
                    writeFavorites(serverFavorites);
                    updateButtons(serverFavorites);
                    showStatus(`Favorite could not be saved: ${error.message}`);
                }
            });
        }, 0);
    }, true);

    window.addEventListener('biterush-cards-rendered', () => {
        const currentButtons = buttons();
        currentButtons.forEach(button => { button.disabled = !ready; });
        updateButtons(authenticated ? serverFavorites : readLocalFavorites());
    });
    window.addEventListener('biterush-favorites-updated', () => {
        updateButtons(readLocalFavorites());
    });

    initialize();
}());
