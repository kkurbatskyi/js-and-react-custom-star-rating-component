import Rating from "./components/Rating"

function App() {
  return (
    <div className="App">
      <Rating maxStars={5}/>
      <Rating maxStars={6}/>
      <Rating maxStars={7}/>
    </div>
  );
}

export default App;
