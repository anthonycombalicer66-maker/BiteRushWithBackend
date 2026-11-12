(function () {
    const CART_KEY = 'biterush_cart';
    const SINGLE_ITEM_CHECKOUT_KEY = 'biterush_single_checkout_keys';
    const PRODUCT_OVERRIDES_KEY = 'biterush_product_overrides';
    const CUSTOM_PRODUCTS_KEY = 'biterush_custom_products';
    const projectPath = location.pathname.match(/^(.*?\/BiteRush)(?:\/|$)/i);
    const projectRootPath = projectPath ? projectPath[1] : '';
    const apiUrl = `${projectRootPath}/api/index.php`;
    const initialAccountId = localStorage.getItem('biterush_active_user_id');
    const accountHeaders = () => {
        const api = window.BiteRushApi;
        if (api && typeof api.accountHeaders === 'function') return api.accountHeaders();
        return initialAccountId ? { 'X-BiteRush-Account': initialAccountId } : {};
    };
    const recoverAccountContext = async () => {
        const response = await fetch(`${apiUrl}?action=me`, { credentials: 'same-origin' });
        const result = await response.json();
        if (!response.ok || !result.user || !Number.isSafeInteger(Number(result.user.id))) {
            throw new Error(result.error || 'Could not verify the active account.');
        }
        const api = window.BiteRushApi;
        if (api && typeof api.setAccountContext === 'function') {
            const changed = api.setAccountContext(result.user);
            if (changed) location.reload();
            return changed;
        }
        const userId = String(Number(result.user.id));
        if (localStorage.getItem('biterush_active_user_id') !== userId) {
            clearAccountCache(userId);
            location.reload();
            return true;
        }
        return false;
    };
    const normalizeTitle = title => String(title || '').trim().toLocaleLowerCase();
    const catalogImageUrl = image => image
        ? new URL(image, `${location.origin}${projectPath ? projectPath[1] : ''}/SearchResults/`).href
        : '';
    let productRatingsRequest;
    const readArray = (key, fallback) => {
        try {
            const value = JSON.parse(localStorage.getItem(key) || 'null');
            return Array.isArray(value) ? value : fallback;
        } catch (error) {
            console.error(`Unable to read ${key}:`, error);
            return fallback;
        }
    };

    const createProductRatingLink = card => {
        const title = card.dataset.title
            || card.querySelector('.food-title, .item-title, h3')?.textContent.trim();
        if (!title) return null;

        card.dataset.title = title;
        const link = card.querySelector('.food-rating-link') || document.createElement('a');
        link.className = 'food-rating-link';
        const reviewsUrl = new URL(
            `${projectPath ? projectPath[1] : ''}/Feedback/index.html`,
            location.origin
        );
        reviewsUrl.searchParams.set('v', '4');
        reviewsUrl.searchParams.set('food', title);
        const detailLink = card.dataset.link
            || card.querySelector('.buy-btn')?.closest('a')?.getAttribute('href')
            || (card.classList.contains('item-card') ? location.pathname : '');
        if (detailLink) {
            reviewsUrl.searchParams.set('path', new URL(detailLink, location.href).pathname);
        }
        link.href = reviewsUrl.href;
        link.setAttribute('aria-label', `Ratings for ${title}`);
        link.title = `Ratings for ${title}`;

        if (!link.isConnected) {
            const container = card.querySelector('.food-info, .search-result-info, .item-details') || card;
            const meta = container.querySelector('.food-meta, .item-meta');
            const priceRow = container.querySelector(
                '.price-container, .search-result-footer, .item-quantity-price'
            );
            if (card.classList.contains('food-card') && meta) meta.appendChild(link);
            else if (meta) meta.insertAdjacentElement('afterend', link);
            else if (priceRow) priceRow.before(link);
            else container.appendChild(link);
        }
        return link;
    };

    const loadProductRatings = () => {
        if (!productRatingsRequest) {
            productRatingsRequest = fetch(`${apiUrl}?action=product-ratings`, {
                credentials: 'same-origin'
            }).then(async response => {
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not load food ratings.');
                if (!result || !Array.isArray(result.ratings)) {
                    throw new Error('The food ratings response is invalid.');
                }
                return new Map(result.ratings.map(rating => [
                    normalizeTitle(rating.foodItem),
                    {
                        average: Number(rating.averageRating),
                        count: Number(rating.ratingCount)
                    }
                ]));
            }).catch(error => {
                productRatingsRequest = null;
                throw error;
            });
        }
        return productRatingsRequest;
    };

    const refreshProductRatings = async () => {
        const cards = [...document.querySelectorAll('.food-card, .search-result-card, .item-card')];
        const links = cards.map(card => ({
            title: card.dataset.title || card.querySelector('.food-title, .item-title, h3')?.textContent.trim(),
            link: createProductRatingLink(card)
        })).filter(item => item.title && item.link);
        if (!links.length) return;

        try {
            const ratings = await loadProductRatings();
            links.forEach(({ title, link }) => {
                const rating = ratings.get(normalizeTitle(title));
                if (!rating || !Number.isFinite(rating.average) || rating.count < 1) {
                    link.textContent = '☆ No ratings yet';
                    link.setAttribute('aria-label', `No ratings yet for ${title}`);
                    return;
                }
                const reviewLabel = rating.count === 1 ? 'review' : 'reviews';
                link.textContent = `★ ${rating.average.toFixed(1)} (${rating.count})`;
                link.setAttribute(
                    'aria-label',
                    `${rating.average.toFixed(1)} out of 5 from ${rating.count} ${reviewLabel} for ${title}`
                );
            });
        } catch (error) {
            console.error('Unable to load food ratings from the server:', error);
            links.forEach(({ title, link }) => {
                link.textContent = 'Ratings unavailable';
                link.setAttribute('aria-label', `Ratings unavailable for ${title}`);
            });
        }
    };

    const appendDatabaseProduct = product => {
        const titleKey = normalizeTitle(product.title);
        if (document.querySelectorAll('.food-card, .search-result-card').length
            && [...document.querySelectorAll('.food-card, .search-result-card')].some(card =>
                normalizeTitle(card.dataset.title || card.querySelector('.food-title, h3')?.textContent) === titleKey
            )) return;

        if (isProjectRootPage) {
            const grid = document.querySelector('.food-grid');
            if (!grid) return;
            const card = document.createElement('div');
            card.className = 'food-card';
            card.dataset.category = product.category || '';
            const image = document.createElement('img');
            image.className = 'food-img';
            image.src = catalogImageUrl(product.image) || '../BiteRushHomePage/HomePagePics/burger.png';
            image.alt = product.title;
            const info = document.createElement('div');
            info.className = 'food-info';
            const title = document.createElement('h2');
            title.className = 'food-title';
            title.textContent = product.title;
            const category = document.createElement('span');
            category.className = 'food-category';
            category.textContent = product.category || 'Menu';
            const description = document.createElement('p');
            description.className = 'food-description';
            description.textContent = product.description || '';
            const price = document.createElement('span');
            price.className = 'price';
            price.textContent = money(product.price);
            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.className = 'add-btn';
            addButton.textContent = 'Add to cart';
            addButton.dataset.title = product.title;
            addButton.dataset.productId = String(product.id);
            addButton.dataset.price = String(product.price);
            addButton.dataset.img = catalogImageUrl(product.image);
            info.append(title, category, description, price, addButton);
            card.append(image, info);
            grid.appendChild(card);
            applyProductSetting(card, product.title);
            return;
        }

        const grid = document.querySelector('.search-results-grid');
        if (!grid) return;
        const query = new URLSearchParams(location.search).get('q')?.trim().toLocaleLowerCase() || '';
        if (query && ![product.title, product.category, product.description]
            .join(' ').toLocaleLowerCase().includes(query)) return;

        const card = document.createElement('article');
        card.className = 'search-result-card';
        const imageBox = document.createElement('div');
        imageBox.className = 'search-result-image';
        const image = document.createElement('img');
        image.src = catalogImageUrl(product.image) || '../BiteRushHomePage/HomePagePics/burger.png';
        image.alt = product.title;
        imageBox.appendChild(image);
        const info = document.createElement('div');
        info.className = 'search-result-info';
        const title = document.createElement('h3');
        title.textContent = product.title;
        const category = document.createElement('div');
        category.className = 'search-result-category';
        category.textContent = product.category || 'Menu';
        card.dataset.category = product.category || '';
        const description = document.createElement('p');
        description.className = 'search-result-description';
        description.textContent = product.description || '';
        const footer = document.createElement('div');
        footer.className = 'search-result-footer';
        const price = document.createElement('span');
        price.className = 'search-result-price';
        price.textContent = money(product.price);
        const addButton = document.createElement('button');
        addButton.type = 'button';
        addButton.className = 'search-result-add add-btn';
        addButton.setAttribute('aria-label', `Add ${product.title} to cart`);
        addButton.dataset.title = product.title;
        addButton.dataset.productId = String(product.id);
        addButton.dataset.price = String(product.price);
        addButton.dataset.img = catalogImageUrl(product.image);
        addButton.textContent = '+';
        footer.append(price, addButton);
        info.append(title, category, description, footer);
        card.append(imageBox, info);
        grid.appendChild(card);
        applyProductSetting(card, product.title);

        const count = grid.querySelectorAll('.search-result-card:not([hidden])').length;
        const summary = document.getElementById('resultsSummary');
        if (summary) {
            summary.textContent = `${count} dish${count === 1 ? '' : 'es'} found`;
        }
    };

    const loadDatabaseCatalog = async () => {
        const response = await fetch(`${apiUrl}?action=products`, { credentials: 'same-origin' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load the menu catalog.');
        if (!result || !Array.isArray(result.products)) {
            throw new Error('The menu catalog response is invalid.');
        }

        result.products.forEach(product => {
            if (!product || !product.title || !Number.isFinite(Number(product.price))) return;
            const key = normalizeTitle(product.title);
            databaseProducts.set(key, product);
            databaseProductsById.set(Number(product.id), product);
            productOverrides[key] = {
                ...(productOverrides[key] || {}),
                databaseId: product.id,
                title: product.title,
                price: Number(product.price),
                category: product.category,
                description: product.description,
                image: product.image,
                stock: product.stock,
                available: product.available,
                deleted: product.deleted
            };
        });

        if (result.products.length) {
            try {
                localStorage.setItem(PRODUCT_OVERRIDES_KEY, JSON.stringify(productOverrides));
            } catch (error) {
                console.error('Unable to cache the database menu catalog:', error);
            }
        }
        applyProductSettings();
        if (!window.BiteRushSharedFoodCards && !isProjectRootPage) {
            result.products.forEach(appendDatabaseProduct);
        }
        cart = cart.map(item => {
            const product = databaseProductFor(item);
            if (!product) return item;
            const updated = {
                ...item,
                title: product.title,
                productId: Number(product.id),
                price: Number(product.price),
                img: catalogImageUrl(product.image) || item.img
            };
            updated.key = itemKey(updated);
            return updated;
        });
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(cart));
        } catch (error) {
            console.error('Unable to cache the database menu prices in your cart:', error);
        }
        render();
        window.dispatchEvent(new CustomEvent('biterush-menu-updated'));
        window.dispatchEvent(new CustomEvent('biterush-cart-updated'));
    };
    const customProducts = readArray(CUSTOM_PRODUCTS_KEY, []);
    const databaseProductFor = item => {
        const productId = Number(item && item.productId);
        if (Number.isSafeInteger(productId) && productId > 0) {
            return databaseProductsById.get(productId) || null;
        }
        if (item && item.link) return null;
        return databaseProducts.get(normalizeTitle(item && item.title)) || null;
    };
    const productOverrideFor = item => {
        const override = productOverrides[normalizeTitle(item && item.title)];
        const productId = Number(item && item.productId);
        if (Number.isSafeInteger(productId) && productId > 0) {
            return Number(override && override.databaseId) === productId ? override : null;
        }
        return item && item.link ? null : override;
    };
    const getStock = item => {
        const product = databaseProductFor(item);
        if (product) {
            return product.stock === null || product.stock === undefined || product.stock === ''
                ? null
                : Math.max(0, Number(product.stock));
        }
        const override = productOverrideFor(item);
        if (override && override.stock !== undefined && override.stock !== null && override.stock !== ''
            && Number.isFinite(Number(override.stock))) return Math.max(0, Number(override.stock));
        const customProduct = customProducts.find(product =>
            product && !item.link && normalizeTitle(product.title) === normalizeTitle(item.title)
        );
        return customProduct && customProduct.stock !== undefined && customProduct.stock !== null && customProduct.stock !== ''
            && Number.isFinite(Number(customProduct.stock))
            ? Math.max(0, Number(customProduct.stock))
            : null;
    };
    const readObject = (key, fallback) => {
        try {
            const value = JSON.parse(localStorage.getItem(key) || 'null');
            return value && typeof value === 'object' ? value : fallback;
        } catch (error) {
            console.error(`Unable to read ${key}:`, error);
            return fallback;
        }
    };
    let productOverrides = readObject(PRODUCT_OVERRIDES_KEY, {});
    const databaseProducts = new Map();
    const databaseProductsById = new Map();
    const readCart = () => {
        try {
            const value = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
            return Array.isArray(value)
                ? value
                    .filter(item => item && item.title && item.img)
                    .map(item => {
                        const product = databaseProductFor(item);
                        const override = productOverrideFor(item);
                        return {
                            ...item,
                            instructions: String(item.instructions || ''),
                            price: product
                                ? Number(product.price)
                                : Number.isFinite(Number(override && override.price))
                                    ? Number(override.price)
                                    : Number(item.price),
                            quantity: Number(item.quantity)
                        };
                    })
                    .filter(item => Number.isFinite(item.price) && item.price >= 0
                        && Number.isSafeInteger(item.quantity) && item.quantity > 0)
                : [];
        } catch (error) {
            console.error('Unable to read cart:', error);
            return [];
        }
    };
    let cart = readCart();

    const saveCart = () => {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        fetch(`${apiUrl}?action=cart`, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', ...accountHeaders() },
            body: JSON.stringify({ items: cart })
        }).then(async response => {
            if (response.status === 401) return;
            if (!response.ok) {
                const result = await response.json();
                if (result.code === 'account_context_changed' || result.code === 'account_context_missing') {
                    if (await recoverAccountContext()) return;
                }
                if (!response.ok) {
                    throw new Error(result.error || 'Could not save your cart.');
                }
            }
        }).catch(error => console.error('Unable to sync cart with the server:', error));
        window.dispatchEvent(new CustomEvent('biterush-cart-updated'));
        render();
    };
    const feedback = document.createElement('div');
    feedback.className = 'shared-cart-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.setAttribute('aria-atomic', 'true');
    feedback.hidden = true;
    document.body.appendChild(feedback);
    let feedbackTimer;
    const notify = message => {
        feedback.textContent = message;
        feedback.hidden = false;
        feedback.classList.add('is-visible');
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => {
            feedback.classList.remove('is-visible');
            feedbackTimer = setTimeout(() => {
                if (!feedback.classList.contains('is-visible')) feedback.hidden = true;
            }, 200);
        }, 3200);
    };
    const money = value => `₱ ${Number(value).toLocaleString('en-PH', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    })}`;
    const itemKey = item => {
        const productId = Number(item && item.productId);
        if (Number.isSafeInteger(productId) && productId > 0) {
            return `product:${productId}|${String(item.instructions || '').trim()}`;
        }
        return item.key || item.link || `${item.title}|${item.img}`;
    };
    const add = item => {
        const product = databaseProductFor(item);
        const override = productOverrideFor(item);
        if ((product && product.deleted === true) || (override && override.deleted === true)) {
            notify(`${item.title} is not currently available.`);
            return false;
        }
        if ((product && product.available === false) || (override && override.available === false)) {
            notify(`${item.title} is currently unavailable.`);
            return false;
        }
        const stock = getStock(item);
        const currentQuantity = cart
            .filter(entry => itemKey(entry) === itemKey(item))
            .reduce((sum, entry) => sum + entry.quantity, 0);
        if (stock !== null && currentQuantity >= stock) {
            notify(stock === 0
                ? `${item.title} is currently out of stock.`
                : `Only ${stock} ${item.title} item${stock === 1 ? ' is' : 's are'} available.`);
            return false;
        }
        if (product) {
            item.title = product.title;
            item.productId = Number(product.id);
            item.price = Number(product.price);
            item.img = catalogImageUrl(product.image) || item.img;
        } else if (override && Number.isFinite(Number(override.price))) {
            item.price = Number(override.price);
        }
        item.img = new URL(item.img, location.href).href;
        item.key = itemKey(item);
        const existing = cart.find(entry => itemKey(entry) === item.key);
        if (existing) {
            existing.price = Number(item.price);
            existing.reviewTitle = item.reviewTitle || existing.reviewTitle || item.title;
            existing.quantity += 1;
        }
        else cart.push({ ...item, quantity: 1 });
        saveCart();
        return true;
    };
    const change = (title, amount) => {
        const item = cart.find(entry => itemKey(entry) === title);
        if (!item) return;
        if (amount > 0) {
            const stock = getStock(item);
            if (stock !== null && item.quantity >= stock) {
                notify(stock === 0
                    ? `${item.title} is currently out of stock.`
                    : `Only ${stock} ${item.title} item${stock === 1 ? ' is' : 's are'} available.`);
                return;
            }
        }
        item.quantity += amount;
        cart = cart.filter(entry => entry.quantity > 0);
        saveCart();
    };

    const existingButton = document.querySelector('.cart-btn');
    const button = existingButton || document.createElement('button');
    if (!existingButton) {
        button.className = 'shared-cart-toggle';
        button.type = 'button';
        button.setAttribute('aria-label', 'Shopping Cart');
        button.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                stroke-linejoin="round" aria-hidden="true">
                <circle cx="9" cy="21" r="1"></circle>
                <circle cx="20" cy="21" r="1"></circle>
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
            </svg>`;
        document.body.appendChild(button);
    }
    const badge = button.querySelector('.cart-badge') || document.createElement('span');
    if (!badge.classList.contains('cart-badge')) {
        badge.className = 'shared-cart-badge';
        button.appendChild(badge);
    }
    const pathname = location.pathname.replace(/\\/g, '/');
    const isMenuPage = /\/BiteRushFoodMenuPages\//i.test(pathname);
    const isProjectRootPage = pathname === '/'
        || /(?:^|\/)BiteRush\/(?:index\.html)?$/i.test(pathname);
    const checkoutPath = `${projectRootPath}/DeliveryAddress/index.html`;

    function applyProductSettings() {
        document.querySelectorAll('.food-card').forEach(card => {
            const title = card.dataset.title || card.querySelector('.food-title')?.textContent.trim();
            applyProductSetting(card, title);
        });
        document.querySelectorAll('.search-result-card').forEach(card => {
            const title = card.querySelector('h3')?.textContent.trim()
                || card.querySelector('.search-result-add')?.dataset.title;
            applyProductSetting(card, title);
        });
        const detailCard = document.querySelector('.item-card');
        if (detailCard) {
            applyProductSetting(detailCard, detailCard.querySelector('.item-title')?.textContent.trim());
        }
    }
    function applyProductSetting(card, title) {
        if (!title) return;
        const override = productOverrides[normalizeTitle(title)];
        if (!override) return;
        const category = card.dataset.category
            || card.querySelector('.food-category, .search-result-category, .item-subtitle')?.textContent.trim();
        const cardProductId = Number(card.dataset.productId);
        const matchesProduct = Number.isSafeInteger(cardProductId) && cardProductId > 0
            ? cardProductId === Number(override.databaseId)
            : Boolean(category && normalizeTitle(category) === normalizeTitle(override.category));
        if (override.databaseId && !matchesProduct) return;
        if (override.databaseId) {
            card.dataset.productId = String(override.databaseId);
            card.querySelectorAll('.add-btn, .search-result-add, .shared-add-detail')
                .forEach(addButton => {
                    addButton.dataset.productId = String(override.databaseId);
                });
        }
        if (override.deleted === true) {
            card.querySelectorAll('.add-btn, .search-result-add, .shared-add-detail')
                .forEach(addButton => {
                    addButton.disabled = true;
                    addButton.setAttribute('aria-disabled', 'true');
                    addButton.title = 'Moved to the recycle bin';
                });
            if (!card.querySelector('.admin-unavailable-label')) {
                const notice = document.createElement('span');
                notice.className = 'admin-unavailable-label';
                notice.textContent = 'Recycle bin';
                card.appendChild(notice);
            }
        }
        if (Number.isFinite(Number(override.price))) {
            card.querySelectorAll('.price, .card-price, .search-result-price, .item-price, .food-price')
                .forEach(price => {
                    price.textContent = `₱ ${Number(override.price).toFixed(0)}`;
                });
            card.dataset.price = String(override.price);
            card.querySelectorAll('.add-btn, .search-result-add').forEach(addButton => {
                addButton.dataset.price = String(override.price);
            });
        }
        if (override.category) {
            card.querySelectorAll('.food-category, .search-result-category, .item-subtitle')
                .forEach(category => {
                    category.textContent = override.category;
                });
        }
        if (typeof override.description === 'string') {
            card.querySelectorAll('.food-description, .search-result-description, .item-description')
                .forEach(description => {
                    description.textContent = override.description;
                });
        }
        if (override.image) {
            const image = catalogImageUrl(override.image);
            card.querySelectorAll('.food-img, .search-result-image img, .item-img')
                .forEach(imageElement => {
                    imageElement.src = image;
                });
            card.dataset.img = image;
            card.querySelectorAll('.add-btn, .search-result-add, .shared-add-detail')
                .forEach(addButton => {
                    addButton.dataset.img = image;
                });
        }
        if (override.available === false) {
            card.querySelectorAll('.add-btn, .search-result-add, .shared-add-detail')
                .forEach(addButton => {
                    addButton.disabled = true;
                    addButton.setAttribute('aria-disabled', 'true');
                    addButton.title = 'Currently unavailable';
                });
            if (!card.querySelector('.admin-unavailable-label')) {
                const notice = document.createElement('span');
                notice.className = 'admin-unavailable-label';
                notice.textContent = 'Currently unavailable';
                card.appendChild(notice);
            }
        } else {
            card.querySelectorAll('.add-btn, .search-result-add, .shared-add-detail')
                .forEach(addButton => {
                    addButton.disabled = false;
                    addButton.removeAttribute('aria-disabled');
                    addButton.removeAttribute('title');
                });
            card.querySelector('.admin-unavailable-label')?.remove();
        }
    }

    function installCatalogControls() {
        const grid = document.querySelector('.food-grid, .search-results-grid');
        if (!grid || !grid.parentElement || grid.parentElement.querySelector('.biterush-catalog-tools')) return;

        const tools = document.createElement('div');
        tools.className = 'biterush-catalog-tools';
        const makeSelect = (id, label, choices) => {
            const wrapper = document.createElement('label');
            wrapper.htmlFor = id;
            wrapper.textContent = label;
            const select = document.createElement('select');
            select.id = id;
            select.setAttribute('aria-label', label);
            choices.forEach(([value, text]) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = text;
                select.appendChild(option);
            });
            wrapper.appendChild(select);
            tools.appendChild(wrapper);
            return select;
        };
        const sort = makeSelect('biterushSort', 'Sort dishes', [
            ['recommended', 'Recommended'],
            ['name', 'Name: A to Z'],
            ['price-low', 'Price: low to high'],
            ['price-high', 'Price: high to low']
        ]);
        const availability = makeSelect('biterushAvailability', 'Filter availability', [
            ['all', 'All dishes'],
            ['available', 'Available only'],
            ['unavailable', 'Unavailable only']
        ]);
        grid.parentElement.insertBefore(tools, grid);
        const cards = () => [...grid.children].filter(card =>
            card.matches('.food-card, .search-result-card')
        );
        const update = () => {
            const ordered = cards();
            if (sort.value === 'name') {
                ordered.sort((first, second) =>
                    (first.querySelector('.food-title, h3')?.textContent.trim() || '')
                        .localeCompare(second.querySelector('.food-title, h3')?.textContent.trim() || '')
                );
            } else if (sort.value === 'price-low' || sort.value === 'price-high') {
                const direction = sort.value === 'price-low' ? 1 : -1;
                ordered.sort((first, second) => {
                    const readPrice = card => Number(
                        card.querySelector('.price, .search-result-price')?.textContent.replace(/[^\d.]/g, '')
                        || card.dataset.price || 0
                    );
                    return (readPrice(first) - readPrice(second)) * direction;
                });
            }
            ordered.forEach(card => {
                grid.appendChild(card);
                const unavailable = Boolean(card.querySelector('.admin-unavailable-label'))
                    || Boolean(card.querySelector('.add-btn:disabled, .search-result-add:disabled'));
                card.hidden = (availability.value === 'available' && unavailable)
                    || (availability.value === 'unavailable' && !unavailable);
            });
        };
        sort.addEventListener('change', update);
        availability.addEventListener('change', update);
        window.addEventListener('biterush-menu-updated', update);
        update();
    }

    applyProductSettings();

    const overlay = document.createElement('div');
    overlay.className = 'shared-cart-overlay';
    const drawer = document.createElement('aside');
    drawer.className = 'shared-cart-drawer';
    drawer.innerHTML = `
        <div class="shared-cart-header">
            <h2>Your Order</h2>
            <button class="shared-cart-close" type="button" aria-label="Close cart">&times;</button>
        </div>
        <div class="shared-cart-items"></div>
        <div class="shared-cart-footer">
            <div class="shared-cart-total"><span>Total:</span><span class="shared-cart-total-value"></span></div>
            <a class="shared-cart-checkout" href="${checkoutPath}">Review payment and address</a>
            <a class="shared-cart-terms" href="${new URL('terms.html', new URL(checkoutPath, location.href)).href}">Terms and privacy</a>
        </div>`;
    document.body.append(overlay, drawer);

    const itemsElement = drawer.querySelector('.shared-cart-items');
    const totalElement = drawer.querySelector('.shared-cart-total-value');
    const render = () => {
        const count = cart.reduce((sum, item) => sum + item.quantity, 0);
        badge.textContent = count;
        button.setAttribute('aria-label', `Shopping Cart, ${count} item${count === 1 ? '' : 's'}`);
        itemsElement.replaceChildren();
        if (!cart.length) {
            const empty = document.createElement('div');
            empty.className = 'shared-cart-empty';
            empty.textContent = 'Your cart is empty.';
            itemsElement.appendChild(empty);
        } else {
            cart.forEach(item => {
                const row = document.createElement('div');
                row.className = 'shared-cart-item';
                const image = document.createElement('img');
                image.src = item.img;
                image.alt = item.title;
                const info = document.createElement('div');
                const title = document.createElement('h3');
                title.textContent = item.title;
                const price = document.createElement('p');
                price.textContent = `${money(item.price)} each`;
                info.append(title, price);
                if (item.instructions) {
                    const notes = document.createElement('p');
                    notes.className = 'shared-cart-item-notes';
                    notes.textContent = `Notes: ${item.instructions}`;
                    info.appendChild(notes);
                }
                const quantity = document.createElement('div');
                quantity.className = 'shared-cart-quantity';
                const decrease = document.createElement('button');
                decrease.type = 'button';
                decrease.dataset.title = itemKey(item);
                decrease.dataset.change = '-1';
                decrease.setAttribute('aria-label', `Remove one ${item.title}`);
                decrease.textContent = '−';
                const count = document.createElement('span');
                count.textContent = item.quantity;
                const increase = document.createElement('button');
                increase.type = 'button';
                increase.dataset.title = itemKey(item);
                increase.dataset.change = '1';
                increase.setAttribute('aria-label', `Add one ${item.title}`);
                increase.textContent = '+';
                quantity.append(decrease, count, increase);
                row.append(image, info, quantity);
                itemsElement.appendChild(row);
            });
        }
        totalElement.textContent = money(cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
    };
    window.addEventListener('storage', event => {
        if (event.key === CART_KEY) {
            cart = readCart();
            render();
        }
    });
    const toggle = () => {
        drawer.classList.toggle('open');
        overlay.classList.toggle('open');
    };
    button.addEventListener('click', toggle);
    overlay.addEventListener('click', toggle);
    drawer.querySelector('.shared-cart-close').addEventListener('click', toggle);
    drawer.addEventListener('click', event => {
        const control = event.target.closest('[data-title]');
        if (control) change(control.dataset.title, Number(control.dataset.change));
    });

    document.addEventListener('click', event => {
        const addButton = event.target.closest('.add-btn');
        if (!addButton) return;
        const card = addButton.closest('.food-card, .search-result-card');
        if (!card) return;
        const image = card.querySelector('.food-img, .search-result-image img');
        const source = addButton.dataset;
        const detailLink = source.link || card.dataset.link || card.querySelector('.buy-btn')?.closest('a')?.getAttribute('href');
        const detailUrl = detailLink ? new URL(detailLink, location.href) : null;
        add({
            title: source.title || card.dataset.title || card.querySelector('.food-title, h3')?.textContent.trim(),
            productId: source.productId ? Number(source.productId) : undefined,
            category: source.category || card.dataset.category
                || card.querySelector('.food-category, .search-result-category')?.textContent.trim(),
            price: Number(source.price || card.dataset.price
                || card.querySelector('.price, .search-result-price')?.textContent.replace(/[^\d.]/g, '')),
            img: source.img || card.dataset.img || image?.getAttribute('src'),
            link: detailUrl ? `${detailUrl.pathname}${detailUrl.search}` : ''
        });
    });

    const detailCard = document.querySelector('.item-card');
    if (detailCard) {
        const routeProductId = Number(new URLSearchParams(location.search).get('id'));
        const dynamicProductId = Number.isSafeInteger(routeProductId) && routeProductId > 0
            ? routeProductId
            : null;
        const detailImage = detailCard.querySelector('.item-img');
        const notes = document.createElement('textarea');
        notes.className = 'dish-special-instructions';
        notes.id = 'dishSpecialInstructions';
        notes.maxLength = 160;
        notes.rows = 2;
        notes.placeholder = 'Optional: special preparation instructions';
        notes.setAttribute('aria-label', 'Optional special preparation instructions');
        const detailInfo = detailCard.querySelector('.item-details');
        if (detailImage) detailImage.after(notes);
        else if (detailInfo) detailInfo.before(notes);
        const currentProductId = () => {
            const productId = Number(detailCard.dataset.productId || dynamicProductId);
            return Number.isSafeInteger(productId) && productId > 0 ? productId : null;
        };
        const detailItem = () => {
            const productId = currentProductId();
            const instructions = notes.value.trim();
            return {
                key: productId
                    ? `product:${productId}|${instructions}`
                    : `${location.pathname}|${instructions}`,
                title: detailCard.querySelector('.item-title')?.textContent.trim(),
                reviewTitle: detailCard.querySelector('.item-subtitle')?.textContent.trim()
                    || detailCard.querySelector('.item-title')?.textContent.trim(),
                productId: productId || undefined,
                category: detailCard.dataset.category
                    || detailCard.querySelector('.item-subtitle')?.textContent.trim(),
                price: Number(detailCard.querySelector('.item-price')?.textContent.replace(/[^\d.]/g, '')),
                img: detailImage?.getAttribute('src'),
                link: `${location.pathname}${location.search}`,
                instructions
            };
        };
        const matchesDetail = item => dynamicProductId
            ? Number(item.productId) === dynamicProductId
            : item.link === location.pathname
                || item.key === location.pathname
                || item.key?.startsWith(`${location.pathname}|`);
        const existingDetailItem = cart.find(matchesDetail);
        const currentDetailPrice = Number(
            detailCard.querySelector('.item-price')?.textContent.replace(/[^\d.]/g, '')
        );
        if (existingDetailItem && Number.isFinite(currentDetailPrice)
            && existingDetailItem.price !== currentDetailPrice) {
            existingDetailItem.price = currentDetailPrice;
            saveCart();
        }
        const getDetailQuantity = () => cart
            .filter(matchesDetail)
            .reduce((sum, item) => sum + item.quantity, 0);
        const detailQuantity = detailCard.querySelector('.qty-count');
        const updateDetailQuantity = () => {
            if (detailQuantity) detailQuantity.textContent = getDetailQuantity() || 1;
        };
        window.addEventListener('biterush-cart-updated', updateDetailQuantity);
        if (!detailCard.querySelector('.shared-add-detail')) {
            const detailAddButton = document.createElement('button');
            detailAddButton.className = 'shared-add-detail';
            detailAddButton.type = 'button';
            detailAddButton.textContent = 'Add to cart';
            detailCard.querySelector('.item-quantity-price')?.appendChild(detailAddButton);
            applyProductSetting(detailCard, detailCard.querySelector('.item-title')?.textContent.trim());
            detailAddButton.addEventListener('click', () => {
                if (add(detailItem())) {
                    drawer.classList.add('open');
                    overlay.classList.add('open');
                }
                updateDetailQuantity();
            });
            detailCard.querySelectorAll('.qty-btn').forEach((control, index) => {
                control.addEventListener('click', () => {
                    if (index === 1) add(detailItem());
                    else {
                        const targetKey = itemKey(detailItem());
                        const item = cart.find(entry => itemKey(entry) === targetKey);
                        if (item) change(itemKey(item), -1);
                    }
                    updateDetailQuantity();
                });
            });
        }
        document.querySelectorAll('.checkout-btn').forEach(checkoutButton => {
            checkoutButton.addEventListener('click', event => {
                event.preventDefault();
                if (!getDetailQuantity() && !add(detailItem())) return;

                const selectedItems = cart.filter(matchesDetail);
                if (!selectedItems.length) {
                    notify('This item could not be prepared for checkout. Please try again.');
                    return;
                }

                try {
                    const selectedKeys = [...new Set(selectedItems.map(itemKey))];
                    sessionStorage.setItem(SINGLE_ITEM_CHECKOUT_KEY, JSON.stringify(selectedKeys));
                } catch (error) {
                    console.error('Unable to prepare single-item checkout:', error);
                    notify('This item could not be prepared for checkout. Please try again.');
                    return;
                }

                const singleItemCheckoutUrl = new URL(checkoutPath, location.href);
                singleItemCheckoutUrl.searchParams.set('checkout', 'single-item');
                location.href = singleItemCheckoutUrl.href;
            });
        });
        updateDetailQuantity();
    }

    window.BiteRushCart = { add, change, notify, get items() { return [...cart]; } };
    window.addEventListener('biterush-menu-updated', refreshProductRatings);
    window.addEventListener('biterush-cards-rendered', refreshProductRatings);
    refreshProductRatings();
    installCatalogControls();
    const clearAccountCache = nextAccountId => {
        [
            'biterush_cart',
            'biterush_favorites',
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
        ].forEach(key => localStorage.removeItem(key));
        sessionStorage.removeItem(SINGLE_ITEM_CHECKOUT_KEY);
        if (nextAccountId === undefined) localStorage.removeItem('biterush_active_user_id');
        else localStorage.setItem('biterush_active_user_id', nextAccountId);
        cart = [];
        render();
    };
    loadDatabaseCatalog().catch(error => {
        console.error('Unable to load the menu catalog from the server:', error);
    }).then(() => fetch(`${apiUrl}?action=cart`, {
        credentials: 'same-origin',
        headers: accountHeaders()
    }))
        .then(async response => {
            if (response.status === 401) {
                if (localStorage.getItem('biterush_active_user_id')) clearAccountCache();
                return null;
            }
            const result = await response.json();
            if (response.status === 409
                && ['account_context_changed', 'account_context_missing'].includes(result.code)) {
                if (await recoverAccountContext()) return null;
            }
            if (!response.ok) throw new Error(result.error || 'Could not load your cart.');
            return result;
        })
        .then(result => {
            if (!result || !Array.isArray(result.items)) return;
            cart = result.items.map(item => {
                const product = databaseProductFor(item);
                if (!product) return item;
                const updated = {
                    ...item,
                    title: product.title,
                    productId: Number(product.id),
                    price: Number(product.price),
                    img: catalogImageUrl(product.image) || item.img
                };
                updated.key = itemKey(updated);
                return updated;
            });
            localStorage.setItem(CART_KEY, JSON.stringify(cart));
            render();
            window.dispatchEvent(new CustomEvent('biterush-cart-updated'));
        })
        .catch(error => console.error('Unable to load cart from the server:', error));
    window.addEventListener('storage', event => {
        if (event.key === 'biterush_active_user_id') {
            if (window.BiteRushApi) return;
            if (event.newValue === initialAccountId) return;
            location.reload();
            return;
        }
        if (isProjectRootPage && event.key === CUSTOM_PRODUCTS_KEY) {
            location.reload();
            return;
        }
        if (event.key === PRODUCT_OVERRIDES_KEY) {
            productOverrides = readObject(PRODUCT_OVERRIDES_KEY, {});
            applyProductSettings();
            window.dispatchEvent(new Event('biterush-menu-updated'));
            cart = readCart();
            render();
        }
    });
    render();
}());
