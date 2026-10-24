import SeasonLink from '../components/SeasonLink';

export default function NotFoundPage() {
  return (
    <div className="panel">
      <h2>Not found</h2>
      <p className="lede">That route doesn't exist.</p>
      <SeasonLink to="/">Back to overview</SeasonLink>
    </div>
  );
}
