import Rating from './components/Rating.js';

function render(){
    let ratings = document.getElementsByClassName('rating');
    let i = 0;
    for(let i = 0; i < ratings.length; i++){
        ReactDOM.render(
            React.createElement(
                Rating,
                {_uuid: i},
                null
            ),
            ratings[i]
        );
    }
}

export default render;