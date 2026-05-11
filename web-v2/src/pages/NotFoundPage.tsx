import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="panel">
      <h2>Not found</h2>
      <p className="lede">That route doesn't exist.</p>
      <Link to="/">Back to overview</Link>
    </div>
  );
}
