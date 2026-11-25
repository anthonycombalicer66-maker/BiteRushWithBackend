(function () {
    'use strict';

    const list = document.getElementById('feedbackList');
    const count = document.getElementById('historyCount');
    const message = document.getElementById('historyMessage');

    function makeStars(rating) {
        const stars = document.createElement('div');
        stars.className = 'feedback-stars';
        stars.setAttribute('aria-label', `${rating || 0} out of 5 stars`);
        for (let value = 1; value <= 5; value += 1) {
            const star = document.createElement('span');
            star.textContent = '★';
            if (value > (Number(rating) || 0)) star.className = 'empty-star';
            stars.appendChild(star);
        }
        return stars;
    }

    function displayDate(value) {
        const date = value ? new Date(value) : null;
        return date && !Number.isNaN(date.getTime())
            ? date.toLocaleString()
            : 'Date unavailable';
    }

    function render(reviews) {
        list.replaceChildren();
        count.textContent = `${reviews.length} ${reviews.length === 1 ? 'rating' : 'ratings'}`;

        if (!reviews.length) {
            const empty = document.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = 'You have not rated any foods yet.';
            list.appendChild(empty);
            return;
        }

        reviews.forEach(review => {
            const row = document.createElement('article');
            row.className = 'feedback-history-item';

            const main = document.createElement('div');
            const title = document.createElement('h2');
            title.className = 'feedback-food-title';
            title.textContent = review.foodItem || 'Rated food';
            main.appendChild(title);
            main.appendChild(makeStars(review.foodRating));

            const ratingCopy = document.createElement('p');
            ratingCopy.className = 'feedback-rating-copy';
            ratingCopy.textContent = `${Number(review.foodRating) || 0} out of 5 food rating`;
            if (review.deliveryRating) {
                ratingCopy.textContent += ` · ${Number(review.deliveryRating)} out of 5 delivery rating`;
            }
            main.appendChild(ratingCopy);

            if (review.comment) {
                const comment = document.createElement('p');
                comment.className = 'feedback-comment';
                comment.textContent = review.comment;
                main.appendChild(comment);
            }

            if (review.adminResponse) {
                const response = document.createElement('p');
                response.className = 'feedback-admin-response';
                response.textContent = `BiteRush response: ${review.adminResponse}`;
                main.appendChild(response);
            }

            const meta = document.createElement('div');
            meta.className = 'feedback-meta';
            const date = document.createElement('time');
            date.textContent = displayDate(review.submittedAt);
            if (review.submittedAt) date.dateTime = review.submittedAt;
            meta.appendChild(date);

            const order = document.createElement('span');
            order.textContent = `Order #${review.orderId || '—'}`;
            meta.appendChild(order);

            if (review.foodItem) {
                const foodLink = document.createElement('a');
                foodLink.className = 'feedback-food-link';
                const url = new URL('../Feedback/index.html', window.location.href);
                url.searchParams.set('food', review.foodItem);
                if (review.foodItemPath) url.searchParams.set('path', review.foodItemPath);
                foodLink.href = url.href;
                foodLink.textContent = 'View ratings';
                meta.appendChild(foodLink);
            }

            row.append(main, meta);
            list.appendChild(row);
        });
    }

    async function loadHistory() {
        try {
            const result = await window.BiteRushApi.request('my-feedback');
            if (!Array.isArray(result.reviews)) {
                throw new Error('The feedback history response is invalid.');
            }
            render(result.reviews);
        } catch (error) {
            console.error('Unable to load feedback history:', error);
            message.hidden = false;
            message.textContent = error.status === 401
                ? 'Sign in to view your feedback history.'
                : error.message || 'Feedback history could not be loaded.';
            render([]);
        }
    }

    loadHistory();
}());
