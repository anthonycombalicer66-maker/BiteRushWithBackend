(function () {
    'use strict';

    const stages = ['received', 'preparing', 'on_the_way', 'delivered'];
    const stageLabels = {
        received: 'Order received',
        preparing: 'Preparing',
        on_the_way: 'On the way',
        delivered: 'Delivered',
        cancelled: 'Cancelled'
    };
    const pageSize = 8;
    let orders = [];
    let filteredOrders = [];
    let selected = new Set();
    let selectedId = '';
    let currentPage = 1;
    let staff;

    const search = document.getElementById('orderSearch');
    const filter = document.getElementById('orderFilter');
    const list = document.getElementById('ordersList');
    const detail = document.getElementById('orderDetail');
    const pagination = document.getElementById('ordersPagination');
    const message = document.getElementById('orderMessage');
    const bulkActions = document.getElementById('bulkActions');

    function money(value) {
        return `₱${(Number(value) || 0).toFixed(2)}`;
    }

    function showMessage(text) {
        message.textContent = text;
        message.hidden = false;
    }

    async function loadOrders() {
        try {
            const session = await window.BiteRushApi.request('staff-session');
            staff = session.staff;
            document.getElementById('staffName').textContent = staff.name;
            const result = await window.BiteRushApi.request('admin-orders', { query: { all: 1 } });
            if (!Array.isArray(result.orders)) throw new Error('The orders response is invalid.');
            orders = result.orders;
            applyFilters();
        } catch (error) {
            console.error('Unable to load staff orders:', error);
            window.location.replace('index.html');
        }
    }

    function applyFilters() {
        const query = search.value.trim().toLowerCase();
        const status = filter.value;
        filteredOrders = orders.filter(order => {
            const statusMatches = status === 'all' || order.status === status;
            const haystack = [
                order.id,
                order.address,
                order.customer_name,
                order.customer_email,
                ...(Array.isArray(order.items) ? order.items.map(item => item.title) : [])
            ].join(' ').toLowerCase();
            return statusMatches && (!query || haystack.includes(query));
        });
        const pages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
        currentPage = Math.min(currentPage, pages);
        document.getElementById('orderCount').textContent =
            `${filteredOrders.length} ${filteredOrders.length === 1 ? 'order' : 'orders'}`;
        renderList();
        renderPagination();
        if (selectedId && !filteredOrders.some(order => order.id === selectedId)) {
            selectedId = '';
            detail.innerHTML = '<p class="empty-order">Select an order to view its details.</p>';
        }
        updateBulkState();
    }

    function renderList() {
        list.replaceChildren();
        const start = (currentPage - 1) * pageSize;
        const pageOrders = filteredOrders.slice(start, start + pageSize);
        if (!pageOrders.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-order';
            empty.textContent = 'No orders match this view.';
            list.appendChild(empty);
            return;
        }
        pageOrders.forEach(order => {
            const row = document.createElement('article');
            row.className = `staff-order-row${order.id === selectedId ? ' is-selected' : ''}`;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = selected.has(order.id);
            checkbox.setAttribute('aria-label', `Select order ${order.id}`);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) selected.add(order.id);
                else selected.delete(order.id);
                updateBulkState();
            });

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'staff-order-select';
            const top = document.createElement('span');
            top.className = 'staff-order-row-top';
            const id = document.createElement('strong');
            id.textContent = `#${order.id}`;
            const status = document.createElement('span');
            status.className = `staff-order-status status-${order.status}`;
            status.textContent = stageLabels[order.status] || 'Order received';
            top.append(id, status);
            const itemNames = (Array.isArray(order.items) ? order.items : [])
                .map(item => `${item.title || 'Item'}${Number(item.quantity) > 1 ? ` x${item.quantity}` : ''}`)
                .join(', ');
            const meta = document.createElement('span');
            meta.className = 'staff-order-row-meta';
            meta.textContent = `${itemNames || 'No items'} · ${order.createdAt ? new Date(order.createdAt).toLocaleString() : ''}`;
            const total = document.createElement('strong');
            total.className = 'staff-order-total';
            total.textContent = money(order.total);
            button.append(top, meta);
            button.addEventListener('click', () => {
                selectedId = order.id;
                renderList();
                renderDetail(order);
            });
            row.append(checkbox, button, total);
            list.appendChild(row);
        });
    }

    function renderPagination() {
        pagination.replaceChildren();
        const pages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
        const previous = document.createElement('button');
        previous.type = 'button';
        previous.textContent = 'Previous';
        previous.disabled = currentPage === 1;
        previous.addEventListener('click', () => {
            currentPage -= 1;
            renderList();
            renderPagination();
        });
        const label = document.createElement('span');
        label.textContent = `Page ${currentPage} of ${pages}`;
        const next = document.createElement('button');
        next.type = 'button';
        next.textContent = 'Next';
        next.disabled = currentPage === pages;
        next.addEventListener('click', () => {
            currentPage += 1;
            renderList();
            renderPagination();
        });
        pagination.append(previous, label, next);
    }

    function updateBulkState() {
        document.getElementById('selectedCount').textContent = String(selected.size);
        bulkActions.hidden = selected.size === 0;
    }

    async function refreshOrderFromServer(orderId) {
        const result = await window.BiteRushApi.request('admin-orders', { query: { all: 1 } });
        orders = result.orders;
        applyFilters();
        const latest = orders.find(order => order.id === orderId);
        if (latest) {
            selectedId = latest.id;
            renderDetail(latest);
        }
    }

    async function saveStatus(orderId, status, cancellationReason = '') {
        const order = orders.find(entry => entry.id === orderId);
        if (!order || order.status === 'delivered' || order.status === 'cancelled') return;
        if (order.adminStatusLocked) {
            showMessage('An admin has already updated this order. Staff can no longer change its status.');
            await refreshOrderFromServer(orderId);
            return;
        }
        if (status === 'cancelled' && !cancellationReason.trim()) {
            showMessage('A cancellation reason is required.');
            return;
        }
        if (status !== 'cancelled'
            && stages.indexOf(status) < stages.indexOf(order.status)) {
            showMessage('Staff can only move order status forward.');
            return;
        }
        try {
            await window.BiteRushApi.request('order-status', {
                method: 'PATCH',
                body: { id: orderId, status, cancellationReason }
            });
            showMessage(status === 'cancelled' ? 'Order cancelled.' : 'Order status updated.');
            await refreshOrderFromServer(orderId);
        } catch (error) {
            showMessage(error.message || 'The order status could not be saved.');
            await refreshOrderFromServer(orderId);
        }
    }

    function renderDetail(order) {
        detail.replaceChildren();
        const title = document.createElement('h3');
        title.textContent = `Order #${order.id}`;
        const timestamp = document.createElement('p');
        timestamp.className = 'detail-timestamp';
        timestamp.textContent = order.createdAt ? new Date(order.createdAt).toLocaleString() : 'Date unavailable';

        const items = document.createElement('ul');
        items.className = 'detail-items';
        (Array.isArray(order.items) ? order.items : []).forEach(item => {
            const row = document.createElement('li');
            row.textContent =
                `${Number(item.quantity) || 1} × ${item.title || 'Item'} — ${money((Number(item.price) || 0) * (Number(item.quantity) || 1))}`;
            items.appendChild(row);
        });

        const dl = document.createElement('dl');
        dl.className = 'order-detail-list';
        [
            ['Subtotal', money(order.subtotal)],
            ['Discount', money(order.discount)],
            ['Delivery fee', money(order.deliveryFee)],
            ['Service fee', money(order.serviceFee)],
            ['Tip', money(order.tip)],
            ['Total', money(order.total)],
            ['Address', order.address || 'No address provided'],
            ['Instructions', order.instructions || 'None'],
            ['Payment', order.payment || '—']
        ].forEach(([label, value]) => {
            dl.append(document.createElement('dt'), document.createElement('dd'));
            dl.children[dl.children.length - 2].textContent = label;
            dl.children[dl.children.length - 1].textContent = value;
        });
        if (order.cancellationReason) {
            dl.append(document.createElement('dt'), document.createElement('dd'));
            dl.children[dl.children.length - 2].textContent = 'Cancellation reason';
            dl.children[dl.children.length - 1].textContent = order.cancellationReason;
        }

        const statusLabel = document.createElement('label');
        statusLabel.className = 'field-label';
        statusLabel.textContent = 'Order status';
        const statusSelect = document.createElement('select');
        statusSelect.className = 'detail-control';
        stages.slice(Math.max(0, stages.indexOf(order.status))).forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = stageLabels[value];
            statusSelect.appendChild(option);
        });
        statusSelect.value = stages.includes(order.status) ? order.status : 'received';
        const finalized = order.status === 'delivered' || order.status === 'cancelled';
        const locked = Boolean(order.adminStatusLocked);
        statusSelect.disabled = finalized || locked;

        const saveStatusButton = document.createElement('button');
        saveStatusButton.type = 'button';
        saveStatusButton.className = 'save-status-button';
        saveStatusButton.textContent = 'Save status';
        saveStatusButton.disabled = finalized || locked;
        saveStatusButton.addEventListener('click', () => saveStatus(order.id, statusSelect.value));

        const actions = document.createElement('div');
        actions.className = 'order-action-buttons';
        const print = document.createElement('button');
        print.type = 'button';
        print.className = 'secondary-button';
        print.textContent = 'Print order';
        print.addEventListener('click', () => {
            detail.classList.add('print-target');
            document.body.classList.add('printing-order');
            window.print();
            detail.classList.remove('print-target');
            document.body.classList.remove('printing-order');
        });
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'secondary-button';
        copy.textContent = 'Copy summary';
        copy.addEventListener('click', async () => {
            const summary = [
                `Order #${order.id}`,
                `Status: ${stageLabels[order.status] || stageLabels.received}`,
                ...items.textContent.split('\n').filter(Boolean),
                `Total: ${money(order.total)}`,
                `Address: ${order.address || 'No address provided'}`
            ].join('\n');
            try {
                await navigator.clipboard.writeText(summary);
                showMessage('Order summary copied.');
            } catch (error) {
                showMessage('Clipboard access is unavailable. Select and copy the order details manually.');
            }
        });
        actions.append(print, copy);

        const cancellationLabel = document.createElement('label');
        cancellationLabel.className = 'field-label';
        cancellationLabel.textContent = 'Cancellation reason';
        const cancellationReason = document.createElement('input');
        cancellationReason.className = 'detail-control';
        cancellationReason.type = 'text';
        cancellationReason.maxLength = 500;
        cancellationReason.placeholder = 'Required to cancel';
        cancellationReason.value = order.cancellationReason || '';
        cancellationReason.disabled = finalized;
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'cancel-order-button';
        cancel.textContent = order.status === 'cancelled' ? 'Cancelled' : 'Cancel order';
        cancel.disabled = finalized;
        cancel.addEventListener('click', () => {
            const reason = cancellationReason.value.trim();
            if (!reason) {
                cancellationReason.focus();
                showMessage('A cancellation reason is required.');
                return;
            }
            saveStatus(order.id, 'cancelled', reason);
        });

        const etaLabel = document.createElement('label');
        etaLabel.className = 'field-label';
        etaLabel.textContent = 'Estimated delivery';
        const etaInput = document.createElement('input');
        etaInput.className = 'detail-control';
        etaInput.type = 'datetime-local';
        etaInput.value = order.estimatedDelivery
            ? new Date(order.estimatedDelivery).toISOString().slice(0, 16)
            : '';

        const staffLabel = document.createElement('label');
        staffLabel.className = 'field-label';
        staffLabel.textContent = 'Assigned staff';
        const staffInput = document.createElement('input');
        staffInput.className = 'detail-control';
        staffInput.type = 'text';
        staffInput.maxLength = 80;
        staffInput.placeholder = 'Staff member name';
        staffInput.value = order.assignedStaff || '';

        const saveDetails = document.createElement('button');
        saveDetails.type = 'button';
        saveDetails.className = 'save-status-button';
        saveDetails.textContent = 'Save delivery details';
        saveDetails.addEventListener('click', async () => {
            try {
                await window.BiteRushApi.request('order-details', {
                    method: 'PATCH',
                    body: {
                        id: order.id,
                        estimatedDelivery: etaInput.value
                            ? new Date(etaInput.value).toISOString()
                            : '',
                        assignedStaff: staffInput.value.trim()
                    }
                });
                showMessage('Delivery details saved.');
                await refreshOrderFromServer(order.id);
            } catch (error) {
                showMessage(error.message || 'Delivery details could not be saved.');
            }
        });

        detail.append(title, timestamp, items, dl, statusLabel, statusSelect, saveStatusButton,
            actions, cancellationLabel, cancellationReason, cancel,
            etaLabel, etaInput, staffLabel, staffInput, saveDetails);
    }

    search.addEventListener('input', () => {
        currentPage = 1;
        applyFilters();
    });
    filter.addEventListener('change', () => {
        currentPage = 1;
        applyFilters();
    });
    document.getElementById('selectPageButton').addEventListener('click', () => {
        const start = (currentPage - 1) * pageSize;
        filteredOrders.slice(start, start + pageSize).forEach(order => selected.add(order.id));
        renderList();
        updateBulkState();
    });
    document.getElementById('clearSelectedButton').addEventListener('click', () => {
        selected.clear();
        renderList();
        updateBulkState();
    });
    document.getElementById('applyBulkButton').addEventListener('click', async () => {
        const status = document.getElementById('bulkStatus').value;
        const ids = [...selected];
        for (const id of ids) await saveStatus(id, status);
        selected.clear();
        renderList();
        updateBulkState();
    });
    document.getElementById('signOutButton').addEventListener('click', async () => {
        try {
            await window.BiteRushApi.request('staff-logout', { method: 'POST', body: {} });
        } catch (error) {
            console.error('Unable to end staff session:', error);
        }
        window.location.href = 'index.html';
    });

    window.addEventListener('focus', () => {
        if (document.visibilityState !== 'hidden') loadOrders();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') loadOrders();
    });
    window.setInterval(loadOrders, 30000);
    loadOrders();
}());
