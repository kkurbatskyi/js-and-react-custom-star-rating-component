

const Star = ({id, Hover, isRated}) => {

    const Type = {
        empty: "☆",
        full: "★",
    }

    let isHovered = id <= Hover.getHover();

    return React.createElement(
        'span',
        {
            style: {color: (!isRated && isHovered) ? "gray" : "black"},
            onMouseEnter : ()=>Hover.setHover(id),
            onMouseLeave : ()=>Hover.setHover(0)
        },
        (isRated || isHovered) ? Type.full : Type.empty
    );

}

export default Star;