    (function () {
        const key = 'biterush_cart';
        const voucherKey = 'biterush_voucher';
        const deliveryKey = 'biterush_delivery';
        const receiptKey = 'biterush_last_order';
        const ordersKey = 'biterush_orders';
        const overridesKey = 'biterush_product_overrides';
        const customProductsKey = 'biterush_custom_products';
        const checkoutKey = 'biterush_checkout_request';
        const singleItemCheckoutKey = 'biterush_single_checkout_keys';
        const singleItemCheckout = new URLSearchParams(window.location.search).get('checkout') === 'single-item';
        const status = document.createElement('p');
        status.className = 'checkout-feedback';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.hidden = true;
        document.body.appendChild(status);
        const notify = message => {
            status.textContent = message;
            status.hidden = false;
        };
        const singleItemKeys = (() => {
            if (!singleItemCheckout) return null;
            try {
                const keys = JSON.parse(sessionStorage.getItem(singleItemCheckoutKey) || 'null');
                if (!Array.isArray(keys) || keys.some(itemKey => typeof itemKey !== 'string')) {
                    throw new Error('The selected checkout items are invalid.');
                }
                return new Set(keys);
            } catch (error) {
                console.error('Unable to read the selected checkout items:', error);
                return new Set();
            }
        })();
        const vouchers = {
            voucher20: { rate: 0.20, cap: 500, minimum: 249 },
            voucher15: { rate: 0.15, cap: 600, minimum: 199 }
        };
        const read = () => {
            try {
                const value = JSON.parse(localStorage.getItem(key) || '[]');
                const overrides = JSON.parse(localStorage.getItem(overridesKey) || '{}');
                const overrideFor = item => {
                    const override = overrides[String(item.title || '').trim().toLocaleLowerCase()];
                    const productId = Number(item.productId);
                    if (Number.isSafeInteger(productId) && productId > 0) {
                        return Number(override?.databaseId) === productId ? override : null;
                    }
                    return item.link ? null : override;
                };
                return Array.isArray(value)
                    ? value
                        .filter(item => item && item.title && item.img)
                        .map(item => {
                            const override = overrideFor(item);
                            return {
                                ...item,
                                price: Number.isFinite(Number(override?.price))
                                    ? Number(override.price)
                                    : Number(item.price),
                                quantity: Number(item.quantity)
                            };
                        })
                        .filter(item => Number.isFinite(item.price) && item.price >= 0
                            && Number.isSafeInteger(item.quantity) && item.quantity > 0)
                    : [];
            } catch (error) {
                console.error('Unable to read checkout cart:', error);
                return [];
            }
        };
        const money = value => `₱ ${Number(value).toFixed(2)}`;
        const cartItemKey = item => {
            const productId = Number(item && item.productId);
            if (Number.isSafeInteger(productId) && productId > 0) {
                return `product:${productId}|${String(item.instructions || '').trim()}`;
            }
            return item.key || item.link || `${item.title}|${item.img}`;
        };
        const selectCheckoutItems = items => singleItemCheckout
            ? items.filter(item => singleItemKeys.has(cartItemKey(item)))
            : items;
        const removeOrderedItems = (items, orderedItems) => {
            const orderedQuantities = new Map();
            orderedItems.forEach(item => {
                const itemKey = cartItemKey(item);
                orderedQuantities.set(itemKey, (orderedQuantities.get(itemKey) || 0) + item.quantity);
            });
            return items.flatMap(item => {
                const itemKey = cartItemKey(item);
                const orderedQuantity = orderedQuantities.get(itemKey) || 0;
                if (!orderedQuantity) return [item];
                const remainingQuantity = item.quantity - orderedQuantity;
                orderedQuantities.set(itemKey, Math.max(0, orderedQuantity - item.quantity));
                return remainingQuantity > 0 ? [{ ...item, quantity: remainingQuantity }] : [];
            });
        };
        const checkoutRequestId = payload => {
            const fingerprint = JSON.stringify(payload);
            let previous = null;
            try {
                previous = JSON.parse(localStorage.getItem(checkoutKey) || 'null');
            } catch (error) {
                console.error('Unable to read the pending checkout request:', error);
            }
            if (previous?.fingerprint === fingerprint && typeof previous.key === 'string') {
                return previous.key;
            }
            const bytes = new Uint8Array(16);
            window.crypto.getRandomValues(bytes);
            const requestKey = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
            localStorage.setItem(checkoutKey, JSON.stringify({ fingerprint, key: requestKey }));
            return requestKey;
        };
        const setText = (selector, value) => {
            document.querySelectorAll(selector).forEach(element => {
                element.textContent = value;
            });
        };
        const update = () => {
            const storedCart = read();
            const itemCard = document.querySelector('.item-card');
            const currentTitle = itemCard?.querySelector('.item-title')?.textContent.trim();
            const currentPrice = Number(
                itemCard?.querySelector('.item-price')?.textContent.replace(/[^\d.]/g, '')
            );
            const itemDetails = itemCard?.querySelector('.item-details');
            if (itemDetails && currentTitle && !itemDetails.querySelector('.food-rating-link')) {
                let reviewsLink = itemDetails.querySelector('.product-reviews-link');
                if (!reviewsLink) {
                    reviewsLink = document.createElement('a');
                    reviewsLink.className = 'product-reviews-link';
                    const foodName = document.createElement('span');
                    foodName.className = 'product-reviews-name';
                    const label = document.createElement('span');
                    label.textContent = 'Ratings';
                    reviewsLink.append(foodName, label);
                    itemDetails.appendChild(reviewsLink);
                }
                const reviewsUrl = new URL('../../../Feedback/index.html', window.location.href);
                reviewsUrl.searchParams.set('v', '4');
                reviewsUrl.searchParams.set('food', currentTitle);
                reviewsUrl.searchParams.set('path', window.location.pathname);
                reviewsLink.href = reviewsUrl.href;
                reviewsLink.querySelector('.product-reviews-name').textContent = currentTitle;
                reviewsLink.setAttribute('aria-label', `See ratings and reviews for ${currentTitle}`);
                reviewsLink.title = `Ratings for ${currentTitle}`;
            }
            const detailProductId = Number(itemCard?.dataset.productId
                || new URLSearchParams(window.location.search).get('id'));
            const currentDetailItem = item => Number.isSafeInteger(detailProductId)
                && detailProductId > 0
                ? Number(item.productId) === detailProductId
                : item.link === window.location.pathname
                    || item.key === window.location.pathname
                    || item.key?.startsWith(`${window.location.pathname}|`);
            const current = storedCart.find(currentDetailItem);
            const detailItems = itemCard && Number.isFinite(currentPrice)
                ? storedCart.filter(currentDetailItem)
                : [];
            const cart = singleItemCheckout
                ? selectCheckoutItems(storedCart)
                : itemCard && Number.isFinite(currentPrice)
                    ? (detailItems.length ? detailItems : [{
                        title: currentTitle,
                        price: currentPrice,
                        quantity: 1
                    }])
                    : storedCart;
            const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
            const selectedVoucher = vouchers[localStorage.getItem(voucherKey)];
            const discount = selectedVoucher && subtotal >= selectedVoucher.minimum
                ? Math.min(subtotal * selectedVoucher.rate, selectedVoucher.cap)
                : 0;
            const delivery = subtotal ? 4 : 0;
            const service = subtotal ? 9 : 0;
            const total = Math.max(0, subtotal - discount + delivery + service);
            if (document.querySelector('.checkout-container')) {
            if (current) {
                const quantity = itemCard.querySelector('.qty-count');
                if (quantity) quantity.textContent = current.quantity;
            }
            const summaryCard = document.querySelector('.summary-card');
            if (summaryCard) {
                let cartLines = summaryCard.querySelector('.checkout-cart-lines');
                if (!cartLines) {
                    cartLines = document.createElement('div');
                    cartLines.className = 'checkout-cart-lines';
                    summaryCard.querySelector('.summary-header')?.after(cartLines);
                }
                cartLines.replaceChildren();
                if (cart.length) {
                    cart.forEach(item => {
                        const row = document.createElement('div');
                        row.className = 'fee-row checkout-cart-line';
                        const info = document.createElement('div');
                        info.className = 'fee-info';
                        const title = document.createElement('span');
                        title.className = 'fee-title';
                        title.textContent = `${item.quantity} × ${item.title}`;
                        const unitPrice = document.createElement('span');
                        unitPrice.className = 'fee-subtext';
                        unitPrice.textContent = `${money(item.price)} each`;
                        const lineTotal = document.createElement('span');
                        lineTotal.className = 'fee-amount';
                        lineTotal.textContent = money(item.price * item.quantity);
                        info.append(title, unitPrice);
                        if (item.instructions) {
                            const itemNotes = document.createElement('span');
                            itemNotes.className = 'fee-subtext checkout-item-notes';
                            itemNotes.textContent = `Notes: ${item.instructions}`;
                            info.appendChild(itemNotes);
                        }
                        row.append(info, lineTotal);
                        cartLines.appendChild(row);
                    });
                } else {
                    const empty = document.createElement('p');
                    empty.className = 'checkout-cart-empty';
                    empty.textContent = 'Your cart is empty.';
                    cartLines.appendChild(empty);
                }
            }
            setText('.header-amount', money(subtotal));
            setText('.total-amount', money(total));
            const deliveryRows = [...document.querySelectorAll('.summary-card .fee-row')].filter(row => {
                const title = row.querySelector('.fee-title')?.textContent.trim().toLowerCase();
                return title === 'standard delivery' || title === 'delivery fee';
            });
            deliveryRows.slice(0, -1).forEach(row => {
                row.hidden = true;
            });
            const feeAmounts = document.querySelectorAll('.summary-card .fee-amount');
            feeAmounts.forEach(amount => {
                const title = amount.closest('.fee-row')?.querySelector('.fee-title')?.textContent.trim().toLowerCase();
                if (title === 'standard delivery' || title === 'delivery fee') amount.textContent = money(delivery);
                if (title === 'service fee') amount.textContent = money(service);
            });
            const discountElement = document.querySelector('.voucher-discount-amount');
            if (discountElement) {
                discountElement.textContent = `-${money(discount)}`;
                discountElement.closest('.voucher-discount-row').hidden = discount === 0;
            }
            }
            if (document.querySelector('.page')) {
            const summary = document.querySelector('.page .summary-item');
            if (summary) {
                summary.replaceChildren();
                if (cart.length) {
                    cart.forEach(item => {
                        const row = document.createElement('div');
                        row.className = 'cart-summary-line';
                        const label = document.createElement('span');
                        label.textContent = `${item.quantity} × ${item.title} (${money(item.price)} each)`;
                        const copy = document.createElement('div');
                        copy.className = 'cart-summary-copy';
                        copy.appendChild(label);
                        if (item.instructions) {
                            const notes = document.createElement('small');
                            notes.className = 'checkout-item-notes';
                            notes.textContent = `Preparation notes: ${item.instructions}`;
                            copy.appendChild(notes);
                        }
                        const lineTotal = document.createElement('strong');
                        lineTotal.textContent = money(item.price * item.quantity);
                        row.append(copy, lineTotal);
                        summary.appendChild(row);
                    });
                } else {
                    const empty = document.createElement('strong');
                    empty.textContent = singleItemCheckout
                        ? 'The selected item could not be loaded. Return to the product page and try again.'
                        : 'Your cart is empty.';
                    summary.appendChild(empty);
                }
            }
            const discountLine = document.querySelector('.page .voucher-discount-line');
            if (discountLine) {
                discountLine.hidden = discount === 0;
                discountLine.querySelector('span:last-child').textContent = `-${money(discount)}`;
            }
            const lines = document.querySelectorAll('.page .summary-line:not(.voucher-discount-line) span:last-child');
            if (lines.length >= 3) {
                lines[0].textContent = money(subtotal);
                lines[1].textContent = money(delivery);
                lines[2].textContent = money(service);
            }
            const finalTotal = document.querySelector('.page .total-price');
            if (finalTotal) finalTotal.textContent = money(total);
            const payment = document.querySelector('.page .payment-row > span:last-child');
            if (payment) payment.textContent = money(total);
            const orderButton = document.querySelector('.page .order-button');
            if (orderButton) {
                orderButton.disabled = cart.length === 0;
                if (!orderButton.dataset.orderHandlerAttached) {
                    orderButton.dataset.orderHandlerAttached = 'true';
                    orderButton.addEventListener('click', async event => {
                        event.preventDefault();
                        const orderedCart = selectCheckoutItems(read());
                        if (!orderedCart.length) return;
                        orderButton.disabled = true;
                        let overrides = {};
                        try {
                            overrides = JSON.parse(localStorage.getItem(overridesKey) || '{}');
                        } catch (error) {
                            console.error('Unable to read product availability:', error);
                            notify('We could not verify menu availability. Please reload checkout and try again.');
                            orderButton.disabled = false;
                            return;
                        }
                        const unavailable = orderedCart.find(item => {
                            const override = overrides[item.title.trim().toLocaleLowerCase()];
                            const productId = Number(item.productId);
                            if (Number.isSafeInteger(productId) && productId > 0
                                && Number(override?.databaseId) !== productId) return false;
                            if (item.link && !(Number.isSafeInteger(productId) && productId > 0)) return false;
                            return override?.available === false || override?.deleted === true;
                        });
                        if (unavailable) {
                            notify(`${unavailable.title} is currently unavailable. Please remove it from your cart before ordering.`);
                            orderButton.disabled = false;
                            return;
                        }

                        let deliveryState = {};
                        try {
                            const savedState = JSON.parse(localStorage.getItem(deliveryKey) || '{}');
                            if (savedState && typeof savedState === 'object') {
                                deliveryState = savedState;
                            }
                        } catch (error) {
                            console.error('Unable to read delivery preferences for order receipt:', error);
                        }

                        const subtotal = orderedCart.reduce(
                            (sum, item) => sum + item.price * item.quantity,
                            0
                        );
                        const voucher = vouchers[localStorage.getItem(voucherKey)];
                        const discount = voucher && subtotal >= voucher.minimum
                            ? Math.min(subtotal * voucher.rate, voucher.cap)
                            : 0;
                        const deliveryFee = subtotal
                            ? Math.max(0, 4 + (Number(deliveryState.adjustment) || 0))
                            : 0;
                        const serviceFee = subtotal ? 9 : 0;
                        const tip = Math.max(0, Number(deliveryState.tip) || 0);
                        const total = Math.max(0, subtotal - discount + deliveryFee + serviceFee + tip);
                        const deliveryLabel = deliveryState.label || 'Standard';
                        const addressInput = document.getElementById('deliveryAddress');
                        const address = addressInput?.value.replace(/\s+/g, ' ').trim() || '';
                        if (address.length < 8) {
                            addressInput?.setCustomValidity('Enter a complete delivery address (at least 8 characters).');
                            addressInput?.reportValidity();
                            addressInput?.focus();
                            orderButton.disabled = false;
                            return;
                        }
                        addressInput?.setCustomValidity('');
                        const instructions = document.getElementById('deliveryInstructions')?.value.trim() || '';
                        const requestBody = {
                            items: orderedCart,
                            voucher: localStorage.getItem(voucherKey) || '',
                            deliveryLabel,
                            deliveryAdjustment: Number(deliveryState.adjustment) || 0,
                            tip,
                            address,
                            instructions,
                            payment: deliveryState.payment || 'Cash'
                        };
                        try {
                            requestBody.idempotencyKey = checkoutRequestId(requestBody);
                            const { order: receipt } = await window.BiteRushApi.request('orders', {
                                method: 'POST',
                                body: requestBody
                            });
                            localStorage.removeItem(checkoutKey);
                            try {
                                localStorage.setItem(receiptKey, JSON.stringify(receipt));
                                const history = JSON.parse(localStorage.getItem(ordersKey) || '[]');
                                localStorage.setItem(ordersKey, JSON.stringify([
                                    receipt,
                                    ...(Array.isArray(history) ? history : [])
                                        .filter(order => order && order.id !== receipt.id)
                                ]));
                            } catch (cacheError) {
                                console.error('Order was saved, but its local display cache could not be updated:', cacheError);
                            }
                            const remainingCart = singleItemCheckout
                                ? removeOrderedItems(read(), orderedCart)
                                : [];
                            if (singleItemCheckout) {
                                localStorage.setItem(key, JSON.stringify(remainingCart));
                                try {
                                    sessionStorage.removeItem(singleItemCheckoutKey);
                                } catch (storageError) {
                                    console.error('Order was saved, but selected checkout state could not be cleared:', storageError);
                                }
                            } else {
                                localStorage.removeItem(key);
                            }
                            localStorage.removeItem(voucherKey);
                            localStorage.removeItem(deliveryKey);
                            try {
                                await window.BiteRushApi.request('cart', {
                                    method: 'PUT',
                                    body: { items: remainingCart }
                                });
                            } catch (cartError) {
                                console.error('Order was saved, but server cart cleanup failed:', cartError);
                            }
                        } catch (error) {
                            console.error('Unable to save completed order:', error);
                            notify(error.message || 'We could not save your order. Please sign in and try again.');
                            orderButton.disabled = false;
                            return;
                        }

                        window.location.href = orderButton.dataset.confirmationHref
                            || '../GobackHome/loading.html';
                    });
                }
            }
            }
        }
        const voucherInputs = document.querySelectorAll('input[name="voucher"]');
        voucherInputs.forEach((input, index) => {
            const voucherId = index === 0 ? 'voucher20' : 'voucher15';
            input.value = voucherId;
            input.checked = localStorage.getItem(voucherKey) === voucherId;
            input.addEventListener('change', () => {
                localStorage.setItem(voucherKey, input.checked ? voucherId : '');
                update();
            });
        });
        const summaryCard = document.querySelector('.summary-card');
        if (summaryCard && !summaryCard.querySelector('.voucher-discount-row')) {
            const row = document.createElement('div');
            row.className = 'fee-row voucher-discount-row';
            row.innerHTML = '<div class="fee-info"><span class="fee-title">Voucher discount</span></div><span class="fee-amount voucher-discount-amount"></span>';
            row.hidden = true;
            summaryCard.querySelector('.voucher-section-title')?.before(row);
        }
        const deliverySummary = document.querySelector('.page .summary-line:last-of-type');
        if (deliverySummary && !document.querySelector('.page .voucher-discount-line')) {
            const row = document.createElement('div');
            row.className = 'summary-line voucher-discount-line';
            row.innerHTML = '<span>Voucher discount</span><span></span>';
            deliverySummary.after(row);
        }
        window.addEventListener('biterush-cart-updated', update);
        window.addEventListener('storage', update);
        update();
    }());
