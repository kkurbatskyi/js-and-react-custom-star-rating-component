import renderProducts from "./products.js"
import renderRatings from "./ratings.js"

document.getElementById("maxStars").onchange = () => {renderProducts(); renderRatings();}
renderProducts();
renderRatings();
