import Product from './components/Product.js';

//Immitation of products for testing purposes 
let productList = [
  { type: "Apple", uuid: 1},
  { type: "Pear", uuid: 2},
  { type: "Plum", uuid: 3},
]

function render(){
  let products = [];
  productList.forEach(p => {
    products = [...products, React.createElement(Product, {key: p.uuid, uuid: p.uuid}, null) ];
  });
  ReactDOM.render(
    products,
    document.getElementById('products')
  );
}

export default render;