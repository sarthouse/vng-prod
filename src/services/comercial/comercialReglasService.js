import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';

export const envioRepo = new BaseRepository({ model: MODELS.metodos_envio });
export const cuponRepo = new BaseRepository({ model: MODELS.cupones });
export const recargoRepo = new BaseRepository({ model: MODELS.recargos_pago });

export function validarCupon({ codigo, subtotal = 0, fecha = '' } = {}) {
  const code = String(codigo || '').trim().toUpperCase();
  if (!code) throw new Error('Ingresá un código de cupón');

  const cupon = cuponRepo.findAll().find(c => String(c.codigo || '').toUpperCase() === code) || null;
  if (!cupon) throw new Error(`Cupón "${code}" no encontrado`);
  if (cupon.activo === 0) throw new Error(`El cupón "${code}" está inactivo`);

  const hoy = fecha || new Date().toISOString().slice(0, 10);
  if (cupon.vigencia_desde && hoy < cupon.vigencia_desde) {
    throw new Error(`El cupón "${code}" aún no está vigente (desde ${cupon.vigencia_desde})`);
  }
  if (cupon.vigencia_hasta && hoy > cupon.vigencia_hasta) {
    throw new Error(`El cupón "${code}" venció el ${cupon.vigencia_hasta}`);
  }
  if (cupon.usos_maximos > 0 && cupon.usos_actuales >= cupon.usos_maximos) {
    throw new Error(`El cupón "${code}" alcanzó el límite de ${cupon.usos_maximos} usos`);
  }

  const base = Math.max(0, Number(subtotal) || 0);
  let descuento = 0;
  if (cupon.tipo === 'porcentaje') {
    descuento = Number((base * (Number(cupon.valor) || 0) / 100).toFixed(2));
  } else if (cupon.tipo === 'fijo') {
    descuento = Number(Math.min(base, Number(cupon.valor) || 0).toFixed(2));
  }

  return {
    cupon,
    codigo: cupon.codigo,
    tipo: cupon.tipo,
    valor: Number(cupon.valor) || 0,
    alicuota_iva: Number(cupon.alicuota_iva ?? 21),
    descuento,
    envio_gratis: cupon.tipo === 'envio_gratis',
  };
}

export function incrementarUsoCupon(codigo) {
  const code = String(codigo || '').trim().toUpperCase();
  if (!code) return;
  const cupon = cuponRepo.findAll().find(c => String(c.codigo || '').toUpperCase() === code);
  if (cupon) {
    cuponRepo.update(cupon.id, { usos_actuales: Number(cupon.usos_actuales || 0) + 1 });
  }
}
