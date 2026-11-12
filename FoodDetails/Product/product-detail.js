(function () {
    'use strict';

    const rootUrl = new URL('../../', location.href);
    const rootPath = rootUrl.pathname.replace(/\/$/, '');
    const productId = Number(new URLSearchParams(location.search).get('id'));
    const card = document.querySelector('[data-product-detail]');
    const status = document.getElementById('productDetailStatus');
    const errorMessage = document.getElementById('productDetailError');
    const imageBase = new URL('SearchResults/', rootUrl);
    const apiUrl = new URL('api/index.php', rootUrl);

    if (Number.isSafeInteger(productId) && productId > 0) {
        card.dataset.productId = String(productId);
    }

    const showError = message => {
        status.hidden = true;
        errorMessage.textContent = message;
        errorMessage.hidden = false;
    };
    const imageUrl = value => {
        if (!value) return new URL('BiteRushHomePage/HomePagePics/burger.png', rootUrl).href;
        if (/^(?:https?:|data:)/i.test(value)) return value;
        return new URL(value, imageBase).href;
    };
    const formatPrice = value => `₱ ${Number(value).toLocaleString('en-PH', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    })}`;
    const appendMeta = (container, text, iconMarkup) => {
        if (!text) return;
        const item = document.createElement('span');
        item.className = 'meta-item';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('width', '14');
        icon.setAttribute('height', '14');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '2');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = iconMarkup;
        item.append(icon, document.createTextNode(text));
        container.appendChild(item);
    };
    const loadProduct = async () => {
        if (!Number.isSafeInteger(productId) || productId < 1) {
            showError('This dish link is invalid. Return to the menu and choose a dish again.');
            return;
        }

        try {
            const url = new URL(apiUrl);
            url.searchParams.set('action', 'product-detail');
            url.searchParams.set('id', String(productId));
            const response = await fetch(url, { credentials: 'same-origin' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not load this dish.');
            if (!result || !result.product || Number(result.product.id) !== productId) {
                throw new Error('The dish response is invalid.');
            }

            const product = result.product;
            const productImage = card.querySelector('.item-img');
            const meta = card.querySelector('.item-meta');
            card.dataset.productId = String(product.id);
            card.dataset.title = product.title;
            card.dataset.category = product.category || 'Menu';
            card.dataset.price = String(product.price);
            card.dataset.img = imageUrl(product.image);
            card.dataset.available = String(product.available !== false);
            card.dataset.link = `${location.pathname}${location.search}`;
            productImage.src = imageUrl(product.image);
            productImage.alt = product.title;
            card.querySelector('.item-title').textContent = product.title;
            card.querySelector('.item-subtitle').textContent = product.category || 'Menu';
            card.querySelector('.item-description').textContent = product.description || '';
            card.querySelector('.item-price').textContent = formatPrice(product.price);
            meta.replaceChildren();
            appendMeta(
                meta,
                product.time || (product.prepTime ? `${product.prepTime} minutes` : ''),
                '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'
            );
            appendMeta(
                meta,
                product.calories || '',
                '<path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line>'
            );

            const back = new URLSearchParams(location.search).get('from');
            if (back) {
                const backUrl = new URL(back, location.origin);
                if (backUrl.origin === location.origin && backUrl.pathname.startsWith(`${rootPath}/`)) {
                    document.getElementById('productDetailBack').href = backUrl.href;
                }
            }

            const unavailable = product.available === false || product.deleted === true || product.stock === 0;
            if (unavailable) {
                card.querySelectorAll('.qty-btn').forEach(button => {
                    button.disabled = true;
                });
                const addButton = card.querySelector('.shared-add-detail');
                if (addButton) addButton.disabled = true;
                const notice = document.createElement('p');
                notice.className = 'product-detail-unavailable';
                notice.setAttribute('role', 'status');
                notice.textContent = product.stock === 0
                    ? 'This dish is currently out of stock.'
                    : 'This dish is currently unavailable.';
                card.querySelector('.item-details').appendChild(notice);
            }
            card.hidden = false;
            document.querySelectorAll('[data-product-detail-content]').forEach(element => {
                element.hidden = false;
            });
            status.hidden = true;
            document.title = `${product.title} | BiteRush`;
            window.dispatchEvent(new CustomEvent('biterush-menu-updated'));
            window.dispatchEvent(new CustomEvent('biterush-cart-updated'));
        } catch (error) {
            console.error('Unable to load dish details:', error);
            showError(error.message || 'Could not load this dish. Please return to the menu and try again.');
        }
    };

    loadProduct();
}());
