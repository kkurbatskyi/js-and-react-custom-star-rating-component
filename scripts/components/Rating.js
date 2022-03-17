
import Star from "./Star.js"

const e = React.createElement;

//mock function that would be on the backend
function updateProduct(uuid, newRating){/*...*/}


const Rating = ({_uuid, maxStars}) => {
 
    const [uuid] = React.useState(_uuid);
    const [rating, setRating] = React.useState(0);
    const [hover, setHover] = React.useState(0);

    const Hover = {
        setHover: (b) => {setHover(b)},
        getHover: () => {return hover},
    }

    const getStars = () => {
        let allStars = [];
        for(let i = 1; i <= maxStars; i++){
            allStars = [...allStars, React.createElement(Star, {key: i, id: i, Hover: Hover, isRated: i <= rating }, null)]
        }
        return allStars;
    }

    const updateRating = async () => {
        setRating(hover);
        //here goes the request to the server to update the rating for a given uuid
        await updateProduct(uuid, rating);
    }

    return React.createElement(
        'div',
        { 
            style: ratingStyle,
            onClick: () => { updateRating() }
        },
        getStars()
    )
}

Rating.defaultProps = {
    maxStars: 5
}

const ratingStyle = {
    fontSize: "2em",
    cursor: "pointer"
}

export default Rating;