/** 
 * 
 * A class that provides a functionality of a rating-scale with a customizable about of stars
 * 
*/
class Rating{
    constructor(uuid, maxStars = 5){
        this.uuid = uuid;

        this.element = document.createElement("div");
        this.element.className = "rating";
        this.element.id = "rate" + this.uuid;
        
        this.element.addEventListener("click", () => {this.updateRating(); this.render()});

        this.maxStars = maxStars;
        this.rating = 0;
        this.hover = 0;
    }

    /**
     * Helps to avoid magic numbers
     */
    Star = {
        empty: "☆",
        full: "★"
    }

    setRating(rating){
        this.rating = rating;
    }

    setHover(hover){
        this.hover = hover;
    }

    async updateRating(){
        this.setRating(this.hover);
        //request to the backend to update rating on a given uuid
        await updateProductRating(this.uuid, this.rating);
    }

    /**
     * 
     * @returns an HTML Element <div> with children of <span>: a render of a rate scale with stars
     */
    render(){
        let stars = []
        for (let i = 1; i <= this.maxStars; i++) {
            stars = [...stars, this.createStar(i)];
        }
        this.element.replaceChildren(...stars);
        return this.element;
    }

    createStar(id){
        const star = document.createElement("span");
        star.setAttribute("id", id);
        star.addEventListener("mouseleave", () => {this.setHover(0); this.render(); });
        star.addEventListener("mouseenter", (e) => 
                                                {
                                                    if(e.target.id == this.hover) return; 
                                                    this.setHover(e.target.id); 
                                                    this.render()
                                                });
        star.className = id <= this.rating ? "rated" : id <= this.hover ? "hovered" : "empty";
        star.innerHTML = id <= this.rating || id <= this.hover ? this.Star.full : this.Star.empty;
        return star;
    }
}

function updateProductRating(uuid, newRating){}
