
const Star = ({id, Hover, isRated}) => {

    const Type = {
        empty: "☆",
        full: "★",
    }

    let isHovered = id <= Hover.getHover();

    return (
        <span
            className= {(!isRated && isHovered) ? "hovered" : isRated ? "rated" : "empty"}
            onMouseEnter ={ ()=>Hover.setHover(id)}
            onMouseLeave = {()=>Hover.setHover(0)}
        >
        { (isRated || isHovered) ? Type.full : Type.empty }
        </span>
    );

}

export default Star;