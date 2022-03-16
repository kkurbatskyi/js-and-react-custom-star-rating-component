
import { useState } from "react";
import Star from "./Star.js"
import "../styles/rating.css"

//mock function that would be on the backend
function updateProduct(uuid, newRating){/*...*/}


const Rating = ({_uuid, maxStars}) => {
 
    const [uuid] = useState(_uuid);
    const [rating, setRating] = useState(0);
    const [hover, setHover] = useState(0);

    const Hover = {
        setHover: (b) => {setHover(b)},
        getHover: () => {return hover},
    }

    const getStars = () => {
        let allStars = [];
        for(let i = 1; i <= maxStars; i++){
            allStars = [...allStars, <Star key={i} id={i} Hover={Hover} isRated= {i <= rating }/>]
        }
        return allStars;
    }

    const updateRating = async () => {
        setRating(hover);
        //here goes the request to the server to update the rating for a given uuid
        await updateProduct(uuid, rating);
    }

    return (
        <div className="rating" onClick={() => { updateRating() }}>
            { getStars() }
        </div>
    )
}

Rating.defaultProps = {
    maxStars: 5
}

export default Rating;