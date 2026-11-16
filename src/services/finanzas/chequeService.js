import { MODELS } from '../../db/models.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { defaultAsientoService } from './asientoService.js';
import { recalcCuentaSaldo } from './tesoreriaService.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const todayIso = () => new Date().toISOString().slice(0, 10);

export class ChequeService {
  constructor({
    chequeRepo = new BaseRepository({ model: MODELS.cheques }),
    cuentaRepo = new BaseRepository({ model: MODELS.cuentas }),
    asientoService = defaultAsientoService,
  } = {}) {
    this.chequeRepo = chequeRepo;
    this.cuentaRepo = cuentaRepo;
    this.asientoService = asientoService;
  }

  _buildCuentaLine(codigo, fallbackNombre, monto, side, contactoId = null, cuentaId = null) {
    const plan = this.asientoService.resolvePlanCuenta(codigo);
    return {
      plan_cuenta_id: plan?.id || null,
      plan_cuenta_codigo: plan?.codigo || codigo,
      contacto_id: contactoId,
      cuenta_id: cuentaId,
      cuenta_contable: plan ? `${plan.codigo} ${plan.nombre}` : `${codigo} ${fallbackNombre}`,
      debe: side === 'debe' ? round2(monto) : 0,
      haber: side === 'haber' ? round2(monto) : 0,
    };
  }

  listCheques({ origen, modalidad, estado, vencimiento_desde, vencimiento_hasta, search } = {}) {
    const qb = this.chequeRepo.query('ch')
      .select(
        'ch.*',
        "COALESCE(cb.nombre, '') as cuenta_bancaria_nombre",
        "COALESCE(co.nombre, '') as contacto_origen_nombre",
        "COALESCE(cd.nombre, '') as contacto_destino_nombre",
      )
      .leftJoin('cuentas', 'cb', 'cb.id', 'ch.cuenta_bancaria_id')
      .leftJoin('contactos', 'co', 'co.id', 'ch.contacto_origen_id')
      .leftJoin('contactos', 'cd', 'cd.id', 'ch.contacto_destino_id')
      .orderBy('ch.fecha_pago', 'ASC')
      .orderBy('ch.id', 'DESC');

    if (origen) qb.where('ch.origen', origen);
    if (modalidad) qb.where('ch.modalidad', modalidad);
    if (estado) qb.where('ch.estado', estado);
    if (vencimiento_desde) qb.where('ch.fecha_pago', '>=', vencimiento_desde);
    if (vencimiento_hasta) qb.where('ch.fecha_pago', '<=', vencimiento_hasta);

    const rows = qb.all();
    if (!search) return rows;
    const q = String(search).trim().toLowerCase();
    return rows.filter(r =>
      `${r.numero || ''} ${r.banco || ''} ${r.librador_nombre || ''} ${r.contacto_origen_nombre || ''}`.toLowerCase().includes(q),
    );
  }

  getChequeById(id) {
    return this.chequeRepo.query('ch')
      .select(
        'ch.*',
        "COALESCE(cb.nombre, '') as cuenta_bancaria_nombre",
        "COALESCE(co.nombre, '') as contacto_origen_nombre",
        "COALESCE(cd.nombre, '') as contacto_destino_nombre",
      )
      .leftJoin('cuentas', 'cb', 'cb.id', 'ch.cuenta_bancaria_id')
      .leftJoin('contactos', 'co', 'co.id', 'ch.contacto_origen_id')
      .leftJoin('contactos', 'cd', 'cd.id', 'ch.contacto_destino_id')
      .where('ch.id', Number(id))
      .get() || null;
  }

  registrarChequeTercero(b, user = null) {
    const monto = round2(b.monto);
    const numero = String(b.numero || '').trim();
    if (!numero) throw new Error('El número de cheque es obligatorio');
    if (monto <= 0) throw new Error('El monto del cheque debe ser mayor a 0');

    const fechaEmision = b.fecha_emision || todayIso();
    const fechaPago = b.fecha_pago || fechaEmision;
    const modalidad = b.modalidad === 'comun' ? 'comun' : 'diferido';
    const contactoId = b.contacto_origen_id ? Number(b.contacto_origen_id) : null;

    return this.chequeRepo.transaction(() => {
      const id = this.chequeRepo.create({
        origen: 'terceros',
        modalidad,
        echeq: b.echeq ? 1 : 0,
        numero,
        banco: String(b.banco || '').trim(),
        sucursal: String(b.sucursal || '').trim(),
        cuit_librador: String(b.cuit_librador || '').trim(),
        librador_nombre: String(b.librador_nombre || '').trim(),
        fecha_emision: fechaEmision,
        fecha_pago: fechaPago,
        monto,
        estado: 'En Cartera',
        contacto_origen_id: contactoId,
        cobro_id: b.cobro_id ? Number(b.cobro_id) : null,
        observaciones: String(b.observaciones || '').trim(),
      }, user);

      if (b.generar_asiento !== false) {
        const diario = this.asientoService.resolveDiario({ tipo: 'caja', caracter: 'ambos' });
        this.asientoService.createAsiento({
          diario_id: diario?.id || null,
          fecha: fechaEmision,
          tipo_origen: 'cheque_tercero',
          origen_id: id,
          concepto: `Ingreso cheque tercero N° ${numero}${b.banco ? ` (${b.banco})` : ''}`,
          estado: 'Confirmado',
          lineas: [
            this._buildCuentaLine('1.1.07', 'Valores a Depositar (Cheques de Terceros)', monto, 'debe'),
            this._buildCuentaLine('1.1.03', 'Deudores por Ventas (Clientes)', monto, 'haber', contactoId),
          ],
        });
      }
      return id;
    });
  }

  depositarCheque(id, { cuenta_id, fecha, acreditar = true } = {}) {
    const ch = this.chequeRepo.findById(Number(id));
    if (!ch) throw new Error('Cheque no encontrado');
    if (ch.origen !== 'terceros') throw new Error('Solo se pueden depositar cheques de terceros');
    if (ch.estado !== 'En Cartera') throw new Error(`El cheque debe estar En Cartera para depositarse (estado actual: ${ch.estado})`);

    const cta = this.cuentaRepo.findById(Number(cuenta_id));
    if (!cta) throw new Error('Cuenta bancaria destino no encontrada');
    if (cta.tipo === 'efectivo') throw new Error('No se puede depositar un cheque en una caja de efectivo');

    const fechaOp = fecha || todayIso();
    return this.chequeRepo.transaction(() => {
      const nextEstado = acreditar ? 'Acreditado' : 'Depositado';
      this.chequeRepo.update(ch.id, {
        estado: nextEstado,
        cuenta_bancaria_id: cta.id,
        fecha_deposito: fechaOp,
        fecha_acreditacion: acreditar ? fechaOp : '',
      });

      if (acreditar) {
        const diario = this.asientoService.resolveDiario({ tipo: 'banco', cuenta_tesoreria_id: cta.id });
        const ctaPlanCodigo = cta.cuenta_contable_id || '1.1.02';
        this.asientoService.createAsiento({
          diario_id: diario?.id || null,
          fecha: fechaOp,
          tipo_origen: 'cheque_deposito',
          origen_id: ch.id,
          concepto: `Depósito cheque N° ${ch.numero} en ${cta.nombre}`,
          estado: 'Confirmado',
          lineas: [
            this._buildCuentaLine(ctaPlanCodigo, cta.nombre || 'Bancos Cuenta Corriente', ch.monto, 'debe', null, cta.id),
            this._buildCuentaLine('1.1.07', 'Valores a Depositar (Cheques de Terceros)', ch.monto, 'haber'),
          ],
        });
        recalcCuentaSaldo(cta.id);
      }
      return this.getChequeById(ch.id);
    });
  }

  acreditarChequeDepositado(id, { fecha } = {}) {
    const ch = this.chequeRepo.findById(Number(id));
    if (!ch) throw new Error('Cheque no encontrado');
    if (ch.origen !== 'terceros' || ch.estado !== 'Depositado') {
      throw new Error('Solo se pueden acreditar cheques de terceros en estado Depositado');
    }
    const cta = this.cuentaRepo.findById(ch.cuenta_bancaria_id);
    if (!cta) throw new Error('El cheque no tiene una cuenta bancaria asociada');

    const fechaOp = fecha || todayIso();
    return this.chequeRepo.transaction(() => {
      this.chequeRepo.update(ch.id, { estado: 'Acreditado', fecha_acreditacion: fechaOp });
      const diario = this.asientoService.resolveDiario({ tipo: 'banco', cuenta_tesoreria_id: cta.id });
      this.asientoService.createAsiento({
        diario_id: diario?.id || null,
        fecha: fechaOp,
        tipo_origen: 'cheque_acreditacion',
        origen_id: ch.id,
        concepto: `Acreditación cheque N° ${ch.numero} en ${cta.nombre}`,
        estado: 'Confirmado',
        lineas: [
          this._buildCuentaLine(cta.cuenta_contable_id || '1.1.02', cta.nombre || 'Bancos Cuenta Corriente', ch.monto, 'debe', null, cta.id),
          this._buildCuentaLine('1.1.07', 'Valores a Depositar (Cheques de Terceros)', ch.monto, 'haber'),
        ],
      });
      recalcCuentaSaldo(cta.id);
      return this.getChequeById(ch.id);
    });
  }

  endosarCheque(id, { contacto_destino_id, pago_id = null, fecha, generar_asiento = true } = {}) {
    const ch = this.chequeRepo.findById(Number(id));
    if (!ch) throw new Error('Cheque no encontrado');
    if (ch.origen !== 'terceros') throw new Error('Solo se pueden endosar cheques de terceros');
    if (ch.estado !== 'En Cartera') throw new Error(`El cheque debe estar En Cartera para endosarse (estado actual: ${ch.estado})`);

    const destinoId = contacto_destino_id ? Number(contacto_destino_id) : null;
    const fechaOp = fecha || todayIso();

    return this.chequeRepo.transaction(() => {
      this.chequeRepo.update(ch.id, {
        estado: 'Endosado',
        contacto_destino_id: destinoId,
        pago_id: pago_id ? Number(pago_id) : ch.pago_id,
      });

      if (generar_asiento !== false) {
        const diario = this.asientoService.resolveDiario({ tipo: 'general' });
        this.asientoService.createAsiento({
          diario_id: diario?.id || null,
          fecha: fechaOp,
          tipo_origen: 'cheque_endoso',
          origen_id: ch.id,
          concepto: `Endoso cheque N° ${ch.numero} a proveedor`,
          estado: 'Confirmado',
          lineas: [
            this._buildCuentaLine('2.1.01', 'Proveedores', ch.monto, 'debe', destinoId),
            this._buildCuentaLine('1.1.07', 'Valores a Depositar (Cheques de Terceros)', ch.monto, 'haber'),
          ],
        });
      }
      return this.getChequeById(ch.id);
    });
  }

  registrarChequePropio(b, user = null) {
    const monto = round2(b.monto);
    const numero = String(b.numero || '').trim();
    if (!numero) throw new Error('El número de cheque propio es obligatorio');
    if (monto <= 0) throw new Error('El monto del cheque debe ser mayor a 0');

    const cta = this.cuentaRepo.findById(Number(b.cuenta_bancaria_id));
    if (!cta) throw new Error('La cuenta bancaria emisora es obligatoria');
    if (cta.tipo === 'efectivo') throw new Error('No se puede emitir un cheque desde una caja de efectivo');

    const fechaEmision = b.fecha_emision || todayIso();
    const fechaPago = b.fecha_pago || fechaEmision;
    const modalidad = b.modalidad === 'comun' ? 'comun' : 'diferido';
    const contactoId = b.contacto_origen_id ? Number(b.contacto_origen_id) : null;

    return this.chequeRepo.transaction(() => {
      const id = this.chequeRepo.create({
        origen: 'propio',
        modalidad,
        echeq: b.echeq ? 1 : 0,
        numero,
        banco: String(b.banco || cta.nombre || '').trim(),
        sucursal: String(b.sucursal || '').trim(),
        fecha_emision: fechaEmision,
        fecha_pago: fechaPago,
        monto,
        estado: 'Emitido',
        cuenta_bancaria_id: cta.id,
        contacto_origen_id: contactoId,
        pago_id: b.pago_id ? Number(b.pago_id) : null,
        observaciones: String(b.observaciones || '').trim(),
      }, user);

      if (b.generar_asiento !== false) {
        const diario = this.asientoService.resolveDiario({ tipo: 'banco', cuenta_tesoreria_id: cta.id });
        this.asientoService.createAsiento({
          diario_id: diario?.id || null,
          fecha: fechaEmision,
          tipo_origen: 'cheque_propio',
          origen_id: id,
          concepto: `Emisión cheque propio N° ${numero} (${cta.nombre})`,
          estado: 'Confirmado',
          lineas: [
            this._buildCuentaLine('2.1.01', 'Proveedores', monto, 'debe', contactoId),
            this._buildCuentaLine('2.1.04', 'Cheques Diferidos a Pagar', monto, 'haber'),
          ],
        });
      }
      return id;
    });
  }

  debitarCheque(id, { fecha } = {}) {
    const ch = this.chequeRepo.findById(Number(id));
    if (!ch) throw new Error('Cheque no encontrado');
    if (ch.origen !== 'propio') throw new Error('Solo se pueden debitar cheques propios');
    if (ch.estado !== 'Emitido') throw new Error(`El cheque debe estar Emitido para debitarse (estado actual: ${ch.estado})`);

    const cta = this.cuentaRepo.findById(ch.cuenta_bancaria_id);
    if (!cta) throw new Error('Cuenta bancaria emisora no encontrada');

    const fechaOp = fecha || todayIso();
    return this.chequeRepo.transaction(() => {
      this.chequeRepo.update(ch.id, { estado: 'Debitado', fecha_acreditacion: fechaOp });

      const diario = this.asientoService.resolveDiario({ tipo: 'banco', cuenta_tesoreria_id: cta.id });
      this.asientoService.createAsiento({
        diario_id: diario?.id || null,
        fecha: fechaOp,
        tipo_origen: 'cheque_debito',
        origen_id: ch.id,
        concepto: `Débito cheque propio N° ${ch.numero} (${cta.nombre})`,
        estado: 'Confirmado',
        lineas: [
          this._buildCuentaLine('2.1.04', 'Cheques Diferidos a Pagar', ch.monto, 'debe'),
          this._buildCuentaLine(cta.cuenta_contable_id || '1.1.02', cta.nombre || 'Bancos Cuenta Corriente', ch.monto, 'haber', null, cta.id),
        ],
      });
      recalcCuentaSaldo(cta.id);
      return this.getChequeById(ch.id);
    });
  }

  rechazarCheque(id, { fecha, motivo = '', gastos_bancarios = 0 } = {}) {
    const ch = this.chequeRepo.findById(Number(id));
    if (!ch) throw new Error('Cheque no encontrado');
    if (['Rechazado', 'Anulado'].includes(ch.estado)) {
      throw new Error(`El cheque ya se encuentra en estado ${ch.estado}`);
    }

    const fechaOp = fecha || todayIso();
    const gastos = Math.max(0, round2(gastos_bancarios));

    return this.chequeRepo.transaction(() => {
      const prevEstado = ch.estado;
      const obs = [ch.observaciones, motivo ? `Rechazo: ${motivo}` : ''].filter(Boolean).join(' | ');
      this.chequeRepo.update(ch.id, { estado: 'Rechazado', observaciones: obs });

      const lineas = [];
      if (ch.origen === 'terceros') {
        const totalRechazo = round2(ch.monto + gastos);
        lineas.push(this._buildCuentaLine('1.1.03', 'Deudores por Ventas (Clientes)', totalRechazo, 'debe', ch.contacto_origen_id));
        if (prevEstado === 'Acreditado' && ch.cuenta_bancaria_id) {
          const cta = this.cuentaRepo.findById(ch.cuenta_bancaria_id);
          if (cta) {
            lineas.push(this._buildCuentaLine(cta.cuenta_contable_id || '1.1.02', cta.nombre || 'Bancos Cuenta Corriente', totalRechazo, 'haber', null, cta.id));
          }
        } else if (prevEstado === 'Endosado') {
          lineas.push(this._buildCuentaLine('2.1.01', 'Proveedores', ch.monto, 'haber', ch.contacto_destino_id));
          if (gastos > 0) {
            lineas.push(this._buildCuentaLine('1.1.02', 'Bancos Cuenta Corriente', gastos, 'haber'));
          }
        } else {
          lineas.push(this._buildCuentaLine('1.1.07', 'Valores a Depositar (Cheques de Terceros)', ch.monto, 'haber'));
          if (gastos > 0) {
            lineas.push(this._buildCuentaLine('1.1.02', 'Bancos Cuenta Corriente', gastos, 'haber'));
          }
        }
      } else {
        // Cheque propio rechazado/anulado antes o después de débito
        lineas.push(this._buildCuentaLine('2.1.04', 'Cheques Diferidos a Pagar', ch.monto, 'debe'));
        if (gastos > 0) {
          lineas.push(this._buildCuentaLine('5.2.05', 'Impuestos, Tasas y Contribuciones', gastos, 'debe'));
        }
        lineas.push(this._buildCuentaLine('2.1.01', 'Proveedores', ch.monto, 'haber', ch.contacto_origen_id));
        if (gastos > 0 && ch.cuenta_bancaria_id) {
          const cta = this.cuentaRepo.findById(ch.cuenta_bancaria_id);
          if (cta) {
            lineas.push(this._buildCuentaLine(cta.cuenta_contable_id || '1.1.02', cta.nombre || 'Bancos Cuenta Corriente', gastos, 'haber', null, cta.id));
          }
        }
      }

      if (lineas.length >= 2) {
        const diario = this.asientoService.resolveDiario({ tipo: 'general' });
        this.asientoService.createAsiento({
          diario_id: diario?.id || null,
          fecha: fechaOp,
          tipo_origen: 'cheque_rechazo',
          origen_id: ch.id,
          concepto: `Rechazo cheque N° ${ch.numero}${motivo ? ` (${motivo})` : ''}`,
          estado: 'Confirmado',
          lineas,
        });
        if (ch.cuenta_bancaria_id) recalcCuentaSaldo(ch.cuenta_bancaria_id);
      }
      return this.getChequeById(ch.id);
    });
  }
}

export const defaultChequeService = new ChequeService();
export const listCheques = (f) => defaultChequeService.listCheques(f);
export const getChequeById = (id) => defaultChequeService.getChequeById(id);
export const registrarChequeTercero = (b, u) => defaultChequeService.registrarChequeTercero(b, u);
export const depositarCheque = (id, opts) => defaultChequeService.depositarCheque(id, opts);
export const acreditarChequeDepositado = (id, opts) => defaultChequeService.acreditarChequeDepositado(id, opts);
export const endosarCheque = (id, opts) => defaultChequeService.endosarCheque(id, opts);
export const registrarChequePropio = (b, u) => defaultChequeService.registrarChequePropio(b, u);
export const debitarCheque = (id, opts) => defaultChequeService.debitarCheque(id, opts);
export const rechazarCheque = (id, opts) => defaultChequeService.rechazarCheque(id, opts);
