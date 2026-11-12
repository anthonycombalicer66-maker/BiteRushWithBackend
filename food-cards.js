(function () {
    'use strict';

    const projectPath = window.location.pathname.match(/^(.*?\/BiteRush)(?:\/|$)/i);
    const projectRoot = projectPath ? projectPath[1] : '';
    const apiUrl = `${projectRoot}/api/index.php`;
    const grid = document.querySelector('.food-grid, .search-results-grid');
    const catalog = Array.isArray(window.BITERUSH_DISHES) ? window.BITERUSH_DISHES : [];
    if (!grid) return;

    window.BiteRushSharedFoodCards = true;
    const normalize = value => String(value || '').trim().toLocaleLowerCase();
    const formatPrice = value => `₱ ${Math.round(Number(value)).toLocaleString('en-PH')}`;
    const imageUrl = value => {
        if (!value) return `${projectRoot}/BiteRushHomePage/HomePagePics/burger.png`;
        if (/^(?:https?:|data:)/i.test(value)) return value;
        return new URL(value, `${location.origin}${projectRoot}/SearchResults/`).href;
    };
    const detailUrl = value => value
        ? new URL(value, `${location.origin}${projectRoot}/SearchResults/`).href
        : '#';
    const getMenu = () => {
        if (grid.classList.contains('search-results-grid')) return 'all';
        const path = location.pathname.toLocaleLowerCase();
        if (path.includes('biterushbreakfastpage')) return 'Breakfast';
        if (path.includes('biterushlunchpage')) return 'Lunch';
        if (path.includes('biterushdinnerpage')) return 'Dinner';
        if (path.includes('biterushbgandfr')) return 'Burger and Fries';
        return 'Home';
    };
    const menuView = getMenu();
    const staticPrice = value => {
        const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*$/);
        return match ? Number(match[1]) : 0;
    };
    const displayText = value => String(value || '')
        .replace(/&ndash;/gi, '–')
        .replace(/&mdash;/gi, '—');
    const makeKey = (title, category) => `${normalize(title)}|${normalize(category)}`;
    const metadataOf = product => product.metadata && typeof product.metadata === 'object'
        ? product.metadata
        : {};
    const matchingQuery = product => {
        const query = new URLSearchParams(location.search).get('q')?.trim().toLocaleLowerCase() || '';
        return !query || [
            product.title, product.category, product.description, product.menu,
            product.tags
        ].join(' ').toLocaleLowerCase().includes(query);
    };
    const dataSet = (product, image, link) => ({
        title: product.title || '',
        category: product.category || '',
        description: product.description || '',
        image,
        price: Number(product.price) || 0,
        menu: product.menu || 'Menu',
        time: product.time || (product.prepTime ? `${product.prepTime} minutes` : ''),
        calories: product.calories || '',
        link,
        productId: product.id || '',
        available: product.available !== false,
        tags: product.tags || ''
    });

    function mergedProducts(serverProducts, deletedProducts) {
        const serverByKey = new Map(serverProducts.map(product =>
            [makeKey(product.title, product.category), product]
        ));
        const deletedKeys = new Set(deletedProducts.map(product => makeKey(product.title, product.category)));
        const usedIds = new Set();
        const existing = catalog.filter(dish => !deletedKeys.has(makeKey(dish.title, dish.category))).map(dish => {
            const saved = serverByKey.get(makeKey(dish.title, dish.category));
            const metadata = saved ? metadataOf(saved) : {};
            if (saved) usedIds.add(Number(saved.id));
            return dataSet({
                ...dish,
                ...saved,
                price: saved?.price ?? staticPrice(dish.price),
                menu: metadata.menu || dish.menu,
                time: displayText(metadata.time || dish.time),
                calories: displayText(metadata.calories || dish.calories),
                link: metadata.link || dish.link,
                tags: metadata.tags || ''
            }, saved?.image || dish.image, metadata.link || dish.link);
        });
        const custom = serverProducts
            .filter(product => !usedIds.has(Number(product.id)))
            .map(product => {
                const metadata = metadataOf(product);
                return dataSet({
                    ...product,
                    menu: metadata.menu || product.category,
                    time: displayText(metadata.time || (metadata.prepTime ? `${metadata.prepTime} minutes` : '')),
                    calories: displayText(metadata.calories || ''),
                    link: metadata.link || '',
                    tags: metadata.tags || ''
                }, product.image, metadata.link || '');
            });
        return [...existing, ...custom].filter(product => {
            if (!product.title || !Number.isFinite(product.price) || product.price <= 0) return false;
            if (menuView !== 'all' && menuView !== 'Home' && normalize(product.menu) !== normalize(menuView)) return false;
            if (menuView === 'Home') {
                const isExistingFeatured = ['tuyobites', 'sandwichbites', 'panbites', 'croissantbites']
                    .includes(normalize(product.title));
                const isNewFeatured = serverProducts.some(saved =>
                    Number(saved.id) === Number(product.productId)
                    && metadataOf(saved).featured === true
                );
                if (!isExistingFeatured && !isNewFeatured) return false;
            }
            return matchingQuery(product);
        });
    }

    function createCard(product) {
        const card = document.createElement('article');
        card.className = 'food-card';
        card.dataset.title = product.title;
        card.dataset.category = product.category;
        card.dataset.menu = product.menu;
        card.dataset.price = String(product.price);
        card.dataset.img = imageUrl(product.image);
        card.dataset.link = detailUrl(product.link);
        if (product.productId) card.dataset.productId = String(product.productId);

        const favorite = document.createElement('button');
        favorite.type = 'button';
        favorite.className = 'favorite-btn';
        favorite.setAttribute('aria-label', `Add ${product.title} to favorites`);
        favorite.setAttribute('aria-pressed', 'false');
        favorite.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';

        const image = document.createElement('img');
        image.className = 'food-img';
        image.src = imageUrl(product.image);
        image.alt = product.title;
        image.loading = 'lazy';

        const info = document.createElement('div');
        info.className = 'food-info';
        const title = document.createElement('h2');
        title.className = 'food-title';
        title.textContent = product.title;
        const hover = document.createElement('div');
        hover.className = 'hover-content';
        const category = document.createElement('span');
        category.className = 'food-category';
        category.textContent = product.category;
        const description = document.createElement('p');
        description.className = 'food-description';
        description.textContent = product.description;
        hover.append(category, description);

        const meta = document.createElement('div');
        meta.className = 'food-meta';
        const details = [product.time, product.calories].filter(Boolean);
        details.forEach((value, index) => {
            const detail = document.createElement('span');
            detail.className = 'meta-item';
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('width', '14');
            icon.setAttribute('height', '14');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('fill', 'none');
            icon.setAttribute('stroke', 'currentColor');
            icon.setAttribute('stroke-width', '2');
            icon.setAttribute('aria-hidden', 'true');
            icon.innerHTML = index === 0
                ? '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'
                : '<path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line>';
            detail.append(icon, document.createTextNode(value));
            meta.appendChild(detail);
        });

        const priceRow = document.createElement('div');
        priceRow.className = 'price-container';
        const price = document.createElement('span');
        price.className = 'price';
        price.textContent = formatPrice(product.price);
        const link = document.createElement('a');
        link.href = detailUrl(product.link);
        const buy = document.createElement('button');
        buy.type = 'button';
        buy.className = 'buy-btn';
        buy.textContent = 'Buy';
        link.appendChild(buy);
        priceRow.append(price, link);
        info.append(title, hover, meta, priceRow);

        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'add-btn';
        add.setAttribute('aria-label', `Add ${product.title} to cart`);
        add.dataset.title = product.title;
        add.dataset.price = String(product.price);
        add.dataset.img = imageUrl(product.image);
        add.dataset.link = detailUrl(product.link);
        if (product.productId) add.dataset.productId = String(product.productId);
        add.textContent = '+';

        card.append(favorite, image, info, add);
        if (!product.available) {
            add.disabled = true;
            add.setAttribute('aria-disabled', 'true');
            const notice = document.createElement('span');
            notice.className = 'admin-unavailable-label';
            notice.textContent = 'Currently unavailable';
            card.appendChild(notice);
        }
        return card;
    }

    function render(serverProducts, deletedProducts = []) {
        const products = mergedProducts(serverProducts, deletedProducts);
        grid.replaceChildren();
        products.forEach(product => grid.appendChild(createCard(product)));
        const summary = document.getElementById('resultsSummary');
        if (summary) {
            summary.textContent = products.length
                ? `${products.length} dish${products.length === 1 ? '' : 'es'} found`
                : 'No dishes match your search.';
        }
        window.dispatchEvent(new CustomEvent('biterush-cards-rendered'));
    }

    async function loadCatalog() {
        const response = await fetch(`${apiUrl}?action=products`, { credentials: 'same-origin' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load the menu catalog.');
        if (!result || !Array.isArray(result.products)) throw new Error('The menu catalog response is invalid.');
        render(
            result.products.filter(product => !product.deleted),
            Array.isArray(result.deletedProducts) ? result.deletedProducts : []
        );
    }

    loadCatalog().catch(error => {
        console.error('Unable to load food cards from the catalog:', error);
        render([]);
    });
    window.addEventListener('focus', () => loadCatalog().catch(error =>
        console.error('Unable to refresh the food catalog:', error)
    ));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            loadCatalog().catch(error => console.error('Unable to refresh the food catalog:', error));
        }
    });
    window.setInterval(() => {
        if (document.visibilityState === 'visible') {
            loadCatalog().catch(error => console.error('Unable to refresh the food catalog:', error));
        }
    }, 30000);

    document.addEventListener('click', event => {
        const button = event.target.closest('.food-card .favorite-btn');
        if (!button) return;
        const card = button.closest('.food-card');
        const title = card?.dataset.title;
        if (!title) return;
        const storageKey = window.BiteRushApi?.getFavoritesStorageKey?.()
            || (localStorage.getItem('biterush_active_user_id')
                ? `biterush_favorites_${localStorage.getItem('biterush_active_user_id')}`
                : 'biterush_favorites_guest');
        let favorites = [];
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
            if (Array.isArray(saved)) favorites = saved;
        } catch (error) {
            console.error('Unable to read favorites for the food card:', error);
        }
        const existing = favorites.find(item => normalize(item.title) === normalize(title));
        if (existing) {
            favorites = favorites.filter(item => normalize(item.title) !== normalize(title));
        } else {
            favorites.push({
                title,
                price: card.dataset.price,
                img: card.dataset.img,
                category: card.querySelector('.food-category')?.textContent || '',
                desc: card.querySelector('.food-description')?.textContent || '',
                link: card.dataset.link,
                productId: card.dataset.productId ? Number(card.dataset.productId) : undefined
            });
        }
        try {
            localStorage.setItem(storageKey, JSON.stringify(favorites));
            button.classList.toggle('favorited', !existing);
            button.setAttribute('aria-pressed', String(!existing));
            button.setAttribute('aria-label', `${existing ? 'Add' : 'Remove'} ${title} ${existing ? 'to' : 'from'} favorites`);
            document.querySelectorAll('.menu-fav-badge, #favBadge').forEach(badge => {
                badge.textContent = String(favorites.length);
            });
            window.dispatchEvent(new Event('biterush-favorites-updated'));
        } catch (error) {
            console.error('Unable to save favorite for the food card:', error);
        }
    });
    document.addEventListener('click', event => {
        const buy = event.target.closest('.food-card .buy-btn');
        const card = buy?.closest('.food-card');
        if (!card || card.dataset.link !== '#') return;
        event.preventDefault();
        card.querySelector('.add-btn')?.click();
    });
}());
