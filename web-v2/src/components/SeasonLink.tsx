import { Link, type LinkProps } from 'react-router-dom';
import { useSelectedSeason } from '../hooks/useSelectedSeason';

// In-app link that keeps a past season selected (?season=N) across navigation.
// The current season is the default, so it adds no param.
export default function SeasonLink({ to, ...rest }: Omit<LinkProps, 'to'> & { to: string }) {
  const { season, isCurrent } = useSelectedSeason();
  return <Link to={isCurrent || season === undefined ? to : `${to}?season=${season}`} {...rest} />;
}
