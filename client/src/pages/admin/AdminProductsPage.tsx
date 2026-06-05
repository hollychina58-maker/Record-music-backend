import { useEffect, useState, useCallback } from 'react';
import { apiService } from '../../services/api';
import './AdminTable.css';
import './AdminProductsPage.css';

interface Product {
  id: number;
  name: string;
  type: string;
  price_cents: number;
  music_limit: number | null;
  description: string;
  is_active: number;
}

interface Coupon {
  id: number;
  code: string;
  discount_percent: number | null;
  discount_cents: number | null;
  valid_from: string | null;
  valid_until: string | null;
  max_uses: number | null;
  used_count: number;
  is_active: number;
}

const emptyProductForm = { name: '', type: 'monthly', price_yuan: '', music_limit: '', description: '' };
const emptyCouponForm = {
  code: '', discount_percent: '', discount_cents: '',
  valid_from: '', valid_until: '', max_uses: '',
};

export function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState(emptyProductForm);

  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [couponForm, setCouponForm] = useState(emptyCouponForm);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pr, cr] = await Promise.all([
        apiService.clientGet('/admin/products'),
        apiService.clientGet('/admin/coupons'),
      ]);
      setProducts(pr.data);
      setCoupons(cr.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleEditProduct = (p: Product) => {
    setEditingProduct(p);
    setProductForm({
      name: p.name,
      type: p.type,
      price_yuan: (p.price_cents / 100).toFixed(2),
      music_limit: p.music_limit != null ? String(p.music_limit) : '',
      description: p.description,
    });
  };

  const handleSaveProduct = async () => {
    const priceCents = Math.round(parseFloat(productForm.price_yuan || '0') * 100);
    const musicLimit = productForm.music_limit ? parseInt(productForm.music_limit) : null;
    const payload = {
      name: productForm.name,
      type: productForm.type,
      priceCents,
      musicLimit,
      description: productForm.description,
    };
    if ((editingProduct as any)?.id) {
      await apiService.clientPut(`/admin/products/${(editingProduct as any).id}`, payload);
    } else {
      await apiService.clientPost('/admin/products', payload);
    }
    setEditingProduct(null);
    setProductForm(emptyProductForm);
    fetchData();
  };

  const handleToggleProduct = async (p: Product) => {
    await apiService.clientPut(`/admin/products/${p.id}`, { isActive: p.is_active ? 0 : 1 });
    fetchData();
  };

  const handleDeleteProduct = async (id: number) => {
    if (!window.confirm('确定删除此套餐？')) return;
    try {
      await apiService.clientDelete(`/admin/products/${id}`);
      fetchData();
    } catch (err: any) {
      alert(err?.response?.data?.error || '删除失败');
    }
  };

  const handleEditCoupon = (c: Coupon) => {
    setEditingCoupon(c);
    setCouponForm({
      code: c.code,
      discount_percent: c.discount_percent != null ? String(c.discount_percent) : '',
      discount_cents: c.discount_cents != null ? (c.discount_cents / 100).toFixed(2) : '',
      valid_from: c.valid_from?.slice(0, 10) || '',
      valid_until: c.valid_until?.slice(0, 10) || '',
      max_uses: c.max_uses != null ? String(c.max_uses) : '',
    });
  };

  const handleSaveCoupon = async () => {
    const payload = {
      code: couponForm.code,
      discountPercent: couponForm.discount_percent ? parseInt(couponForm.discount_percent) : null,
      discountCents: couponForm.discount_cents ? Math.round(parseFloat(couponForm.discount_cents) * 100) : null,
      validFrom: couponForm.valid_from || null,
      validUntil: couponForm.valid_until || null,
      maxUses: couponForm.max_uses ? parseInt(couponForm.max_uses) : null,
    };
    if ((editingCoupon as any)?.id) {
      await apiService.clientPut(`/admin/coupons/${(editingCoupon as any).id}`, payload);
    } else {
      await apiService.clientPost('/admin/coupons', payload);
    }
    setEditingCoupon(null);
    setCouponForm(emptyCouponForm);
    fetchData();
  };

  const handleDeleteCoupon = async (id: number) => {
    if (!window.confirm('确定删除此优惠码？')) return;
    await apiService.clientDelete(`/admin/coupons/${id}`);
    fetchData();
  };

  if (loading) return <div className="admin-loading">加载中...</div>;

  const typeLabel = (t: string) =>
    t === 'per_use' ? '按次' : t === 'monthly' ? '月卡' : '年卡';

  return (
    <div className="admin-table-page">
      <h1 className="admin-page-title">套餐与优惠管理</h1>

      {/* Products section */}
      <h2 className="admin-section-title">套餐列表</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>类型</th>
            <th>价格</th>
            <th>次数限制</th>
            <th>描述</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} style={!p.is_active ? { opacity: 0.55 } : undefined}>
              <td>{p.id}</td>
              <td>{p.name}</td>
              <td>{typeLabel(p.type)}</td>
              <td>¥{(p.price_cents / 100).toFixed(2)}</td>
              <td>{p.music_limit === null ? '无限' : p.music_limit}</td>
              <td className="td-content">{p.description}</td>
              <td>
                <span className={`status-badge ${p.is_active ? 'status-active' : 'status-banned'}`}>
                  {p.is_active ? '启用' : '禁用'}
                </span>
              </td>
              <td className="td-actions">
                <button
                  className={`admin-btn admin-btn-sm ${p.is_active ? 'admin-btn-warn' : ''}`}
                  onClick={() => handleToggleProduct(p)}
                >
                  {p.is_active ? '禁用' : '启用'}
                </button>
                <button className="admin-btn admin-btn-sm" onClick={() => handleEditProduct(p)}>编辑</button>
                <button className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => handleDeleteProduct(p.id)}>删除</button>
              </td>
            </tr>
          ))}
          {products.length === 0 && (
            <tr><td colSpan={8} className="td-empty">暂无套餐</td></tr>
          )}
        </tbody>
      </table>

      <button
        className="admin-btn admin-btn-add"
        onClick={() => { setEditingProduct({} as Product); setProductForm(emptyProductForm); }}
      >
        + 新增套餐
      </button>

      {/* Coupons section */}
      <h2 className="admin-section-title" style={{ marginTop: 40 }}>优惠码列表</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>优惠码</th>
            <th>折扣</th>
            <th>减免</th>
            <th>有效期</th>
            <th>使用/上限</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {coupons.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td><code>{c.code}</code></td>
              <td>{c.discount_percent ? `${c.discount_percent}%` : '-'}</td>
              <td>{c.discount_cents ? `¥${(c.discount_cents / 100).toFixed(2)}` : '-'}</td>
              <td>{c.valid_from ? `${c.valid_from.slice(0, 10)} ~ ${c.valid_until?.slice(0, 10)}` : '永久'}</td>
              <td>{c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
              <td className="td-actions">
                <button className="admin-btn admin-btn-sm" onClick={() => handleEditCoupon(c)}>编辑</button>
                <button className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => handleDeleteCoupon(c.id)}>删除</button>
              </td>
            </tr>
          ))}
          {coupons.length === 0 && (
            <tr><td colSpan={7} className="td-empty">暂无优惠码</td></tr>
          )}
        </tbody>
      </table>

      <button
        className="admin-btn admin-btn-add"
        onClick={() => { setEditingCoupon({} as Coupon); setCouponForm(emptyCouponForm); }}
      >
        + 新增优惠码
      </button>

      {/* Product Edit Modal */}
      {editingProduct && (
        <div className="modal-overlay" onClick={() => setEditingProduct(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{(editingProduct as any).id ? '编辑套餐' : '新增套餐'}</h3>
            <label>名称</label>
            <input value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} />
            <label>类型</label>
            <select value={productForm.type} onChange={(e) => setProductForm({ ...productForm, type: e.target.value })}>
              <option value="per_use">按次付费</option>
              <option value="monthly">月度会员</option>
              <option value="yearly">年度会员</option>
            </select>
            <label>价格（元）</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={productForm.price_yuan}
              placeholder="如 29.99"
              onChange={(e) => setProductForm({ ...productForm, price_yuan: e.target.value })}
            />
            <label>音乐次数限制（留空=无限）</label>
            <input
              type="number"
              value={productForm.music_limit}
              placeholder="如 10"
              onChange={(e) => setProductForm({ ...productForm, music_limit: e.target.value })}
            />
            <label>描述</label>
            <input value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })} />
            <div className="modal-actions">
              <button className="admin-btn" onClick={handleSaveProduct}>保存</button>
              <button className="admin-btn admin-btn-cancel" onClick={() => setEditingProduct(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Coupon Edit Modal */}
      {editingCoupon && (
        <div className="modal-overlay" onClick={() => setEditingCoupon(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{(editingCoupon as any).id ? '编辑优惠码' : '新增优惠码'}</h3>
            <label>优惠码</label>
            <input
              value={couponForm.code}
              onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })}
              disabled={!!(editingCoupon as any).id}
            />
            <label>折扣百分比（如 20 = 打八折）</label>
            <input
              type="number"
              value={couponForm.discount_percent}
              placeholder="如 20"
              onChange={(e) => setCouponForm({ ...couponForm, discount_percent: e.target.value })}
            />
            <label>固定减免（元）</label>
            <input
              type="number"
              step="0.01"
              value={couponForm.discount_cents}
              placeholder="如 5.00"
              onChange={(e) => setCouponForm({ ...couponForm, discount_cents: e.target.value })}
            />
            <label>生效日期</label>
            <input type="date" value={couponForm.valid_from} onChange={(e) => setCouponForm({ ...couponForm, valid_from: e.target.value })} />
            <label>过期日期</label>
            <input type="date" value={couponForm.valid_until} onChange={(e) => setCouponForm({ ...couponForm, valid_until: e.target.value })} />
            <label>使用次数上限（留空=不限）</label>
            <input
              type="number"
              value={couponForm.max_uses}
              placeholder="如 100"
              onChange={(e) => setCouponForm({ ...couponForm, max_uses: e.target.value })}
            />
            <div className="modal-actions">
              <button className="admin-btn" onClick={handleSaveCoupon}>保存</button>
              <button className="admin-btn admin-btn-cancel" onClick={() => setEditingCoupon(null)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
