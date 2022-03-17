The three folders here contain the source code for the three ways I made Star Rating component: 

**Please note: for each type of solution a link to the hosted demonstration website is provided for your convenience**

# React App
### Webpage
[https://kkurbatskyi.github.io/q2-all-react/](https://kkurbatskyi.github.io/q2-all-react/)
### Content: 
```
public----\
          index.html
src-------\
          components--\
                      Rating.js
                      Star.js
          styles------\
                      rating.css
          App.js
          index.js
```
In *src* `components` folder contains the two components: `Rating`, which is the rating bar, and takes props of `uuid` and `maxStars` (which customizes the total amount of stars on the bar), and `Star` of which the `Rating` component is built. `Star` takes in several helper props, but it is not intended to be used outside the `Rating` component.
App.js is the "parent component" of the app, it contains all the components in it.
index.js is the "main" JS file of the app, it renders the App component.

### Run
Since it is a React App, to launch you need to run 
```
npm i
npm react run
```
First - to install dependencies, second - to run.

To avoid the struggle, please ise the [website](https://github.com/kkurbatskyi/picovoice_screening_questions/blob/main/Q2JS/README.md#webpage) link provided above.

# Non-app website with React components used
### Webpage
[https://kkurbatskyi.github.io/q2-minimum-react/](https://kkurbatskyi.github.io/q2-minimum-react/)
### Content: 
```
script-------\
          components--\
                      Product.js
                      Rating.js
                      Star.js
          products.js
          ratings.js
          index.js
index.html
```
In this index.html I have also added the slider that selects the maximum number of stars in the products. It dynamically changes.
In `script/components` beside from the two components discussed in the previous section, there is a `Product` component. In contains a Rating component and potentially could become a full-on product component, but right now it exists just to pass a `maxStars` value to the `Rating` components to demonstrate its customability.
In `script`, `products.js` contains a mock lish of products  (that would otherwise be fetched from the database) for demonstration purposes. It exports a function to render those products as `Product` components. `ratings.js` exports a function to render all the `Rating` components, placing them inside the `<div class="rating"></div>` elements, using the index of the element as uuid.
`index.js` is the main script of the website where it all comes toghether: it renders out the products and ratings, as well as setting product rating's amount of stars to be updated on slider change.
### Run
Due to `type="model"` in the last `<script>` tag, the website cannot be run as a local file and has to be run on a `http` protocol. `localhost` would suffice. To avoid the trouble, please navigate to the [website](https://github.com/kkurbatskyi/picovoice_screening_questions/blob/main/Q2JS/README.md#webpage-1) noted in the section above. 

# Website with plain JS
### Webpage
[https://kkurbatskyi.github.io/q2-vanilla-js/](https://kkurbatskyi.github.io/q2-vanilla-js/)
### Content: 
```
script-------\
          rating.js
styles------\
          rating.css
index.html
index.js
```
Here, `rating.js` is a JS-"class" that contains in itself the functionality of both `Rating` and `Star`. By invoking the constructor you create a new Rating object, but you would need to use `render()` function for the object to return the HTML representation of itself. It auto-renders on click/hover.
`index.js` renders the `Rating` components inside the `<div class="rating"></div>` elements.
### Run
You can run the website by simply launching `index.html` in your browser. You can also navigate to the [website](https://github.com/kkurbatskyi/picovoice_screening_questions/blob/main/Q2JS/README.md#webpage-2) in the section above.
