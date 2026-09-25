import { Link } from "react-router-dom";
import { Nav } from "../components/ui";

export default function NotFound() {
  return (
    <>
      <Nav />
      <main className="page center">
        <span className="label">Error 404 · sheet missing</span>
        <h1 className="h2">This page isn't on the drawings.</h1>
        <Link className="btn btn--solid" to="/">Back to CrossBridge</Link>
      </main>
    </>
  );
}
