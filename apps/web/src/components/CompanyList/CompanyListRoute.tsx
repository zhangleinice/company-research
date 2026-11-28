import { useLocation, useNavigate } from 'react-router-dom';
import { CompanyListPage } from './index.js';
import { companyPath } from '../../utils/routes.js';
export function ListRoute({ favorites = false }: { favorites?: boolean }) {
  const location = useLocation(),
    navigate = useNavigate();
  const from = location.pathname + location.search;
  return (
    <CompanyListPage
      key={location.pathname}
      favorites={favorites}
      onOpen={(ticker) => navigate(companyPath(ticker, from))}
    />
  );
}
