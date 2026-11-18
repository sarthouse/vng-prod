/**
 * SSOT de Provincias Argentinas, Jurisdicciones IIBB / SIFERE (901-924)
 * y códigos ISO 3166-2:AR de 1 letra para integración con WooCommerce.
 */
export const JURISDICCIONES_AR = [
  { codigo: '901', letra: 'C', nombre: 'Ciudad Autónoma de Buenos Aires' },
  { codigo: '902', letra: 'B', nombre: 'Buenos Aires' },
  { codigo: '903', letra: 'K', nombre: 'Catamarca' },
  { codigo: '904', letra: 'X', nombre: 'Córdoba' },
  { codigo: '905', letra: 'W', nombre: 'Corrientes' },
  { codigo: '906', letra: 'H', nombre: 'Chaco' },
  { codigo: '907', letra: 'U', nombre: 'Chubut' },
  { codigo: '908', letra: 'E', nombre: 'Entre Ríos' },
  { codigo: '909', letra: 'P', nombre: 'Formosa' },
  { codigo: '910', letra: 'Y', nombre: 'Jujuy' },
  { codigo: '911', letra: 'L', nombre: 'La Pampa' },
  { codigo: '912', letra: 'F', nombre: 'La Rioja' },
  { codigo: '913', letra: 'M', nombre: 'Mendoza' },
  { codigo: '914', letra: 'N', nombre: 'Misiones' },
  { codigo: '915', letra: 'Q', nombre: 'Neuquén' },
  { codigo: '916', letra: 'R', nombre: 'Río Negro' },
  { codigo: '917', letra: 'A', nombre: 'Salta' },
  { codigo: '918', letra: 'J', nombre: 'San Juan' },
  { codigo: '919', letra: 'D', nombre: 'San Luis' },
  { codigo: '920', letra: 'Z', nombre: 'Santa Cruz' },
  { codigo: '921', letra: 'S', nombre: 'Santa Fe' },
  { codigo: '922', letra: 'G', nombre: 'Santiago del Estero' },
  { codigo: '923', letra: 'T', nombre: 'Tucumán' },
  { codigo: '924', letra: 'V', nombre: 'Tierra del Fuego' },
];

export const PROVINCIAS_AR = JURISDICCIONES_AR.map(j => j.nombre);

export function getJurisdiccionByProvincia(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const norm = raw.toLowerCase();
  const cleanLetter = norm.startsWith('ar-') ? norm.slice(3) : norm;
  return JURISDICCIONES_AR.find(j =>
    j.nombre.toLowerCase() === norm
    || j.codigo === raw
    || j.letra.toLowerCase() === cleanLetter
  ) || null;
}
