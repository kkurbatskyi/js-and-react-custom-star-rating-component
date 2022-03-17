The three folders here contain the source code for the three ways I made Star Rating component: 

## React App
# Webpage
https://kkurbatskyi.github.io/q2-vanilla-js/
# Content: 
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

# Run
Since it is a React App, to launch you need to run 
```
npm i
npm react run
```
First - to install dependencies, second - to run.

#
