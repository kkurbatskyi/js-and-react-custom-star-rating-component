//rendering all "products"
const products = document.getElementsByClassName("product");
let ratings = [];
[...products].forEach((product, index) => {
    ratings = [...ratings, new Rating(product.id, 5)]
    product.appendChild(ratings[index].render());
});

//adding one last rating with 6 stars instead
ratings = [...ratings, new Rating(ratings.length, 6)]
document.body.appendChild(ratings[ratings.length - 1].render());