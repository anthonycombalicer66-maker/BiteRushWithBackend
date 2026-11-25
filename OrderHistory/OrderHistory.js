(function () {
    'use strict';

    const list = document.getElementById('ordersList');
    const count = document.getElementById('historyCount');
    const message = document.getElementById('historyMessage');
    const stageLabels = {
        received: 'Order received',
        preparing: 'Preparing',
        on_the_way: 'On the way',
        delivered: 'Delivered',
        cancelled: 'Cancelled'
    };

    const money = value => `₱ ${Number(value || 0).toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;

    function readLocalHistory() {
        try {
            const value = JSON.parse(localStorage.getItem('biterush_orders') || '[]');
            return Array.isArray(value) ? value : [];
        } catch (error) {
            return [];
        }
    }

    function openOrder(order) {
        localStorage.setItem('biterush_last_order', JSON.stringify(order));
        window.location.href = '../GobackHome/index.html';
    }

    function render(orders) {
        list.replaceChildren();
        count.textContent = `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`;

        if (!orders.length) {
            const empty = document.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = 'You have not placed any orders yet.';
            list.appendChild(empty);
            return;
        }

        orders.forEach(order => {
            const row = document.createElement('article');
            row.className = 'history-order';

            const main = document.createElement('div');
            main.className = 'history-order-main';
            const title = document.createElement('div');
            title.className = 'history-order-title';
            const number = document.createElement('strong');
            number.textContent = `Order #${order.id || '—'}`;
            const status = document.createElement('span');
            status.className = `history-status status-${order.status || 'received'}`;
            status.textContent = stageLabels[order.status] || stageLabels.received;
            title.append(number, status);

            const date = document.createElement('p');
            date.className = 'history-order-meta';
            const dateValue = order.createdAt ? new Date(order.createdAt) : null;
            date.textContent = dateValue && !Number.isNaN(dateValue.getTime())
                ? dateValue.toLocaleString()
                : 'Date unavailable';

            const itemText = (Array.isArray(order.items) ? order.items : [])
                .map(item => `${Number(item.quantity) || 1} × ${item.title || 'Item'}`)
                .join(', ');
            const items = document.createElement('p');
            items.className = 'history-order-items';
            items.textContent = itemText || 'No items available';
            main.append(title, date, items);

            const side = document.createElement('div');
            side.className = 'history-order-side';
            const total = document.createElement('span');
            total.className = 'history-order-total';
            total.textContent = money(order.total);
            const view = document.createElement('button');
            view.type = 'button';
            view.className = 'history-view-button';
            view.textContent = 'View receipt';
            view.addEventListener('click', () => openOrder(order));
            side.append(total, view);

            row.append(main, side);
            list.appendChild(row);
        });
    }

    async function loadHistory() {
        const localOrders = readLocalHistory();
        if (localOrders.length) render(localOrders);

        try {
            const result = await window.BiteRushApi.request('orders');
            if (!Array.isArray(result.orders)) throw new Error('The order history response is invalid.');
            localStorage.setItem('biterush_orders', JSON.stringify(result.orders));
            if (result.orders.length) {
                localStorage.setItem('biterush_last_order', JSON.stringify(result.orders[0]));
            }
            render(result.orders);
        } catch (error) {
            console.error('Unable to load order history:', error);
            if (error.status === 401) {
                message.textContent = 'Sign in to view your order history.';
                message.hidden = false;
            } else if (!localOrders.length) {
                message.textContent = error.message || 'Order history could not be loaded.';
                message.hidden = false;
            }
        }
    }

    loadHistory();
}());
