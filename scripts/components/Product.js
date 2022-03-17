import Rating from './Rating.js';

const Product = ({uuid}) => {
    
    return React.createElement(
        Rating, 
        { 
            key: uuid, 
            _uuid: uuid, 
            maxStars: (document.getElementById("maxStars")? document.getElementById("maxStars").value : 5) 
        }, 
        null
    );
}

export default Product;