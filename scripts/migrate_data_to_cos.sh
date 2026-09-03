#!/usr/bin/env bash
# ============================================================
# 把 cg-resource-hub 的 data/tools_uploads/ 迁移到腾讯云 COS
# 注意: 本项目真正的资源(9.5GB blend_assets)走百度网盘,不在服务器上;
#       只有 data/tools_uploads/(在线工具上传的 .hip/.zip)需要单独存放。
# 用法: 在腾讯云轻量服务器上执行,需要先安装 coscli
# 安装: wget -O /usr/local/bin/coscli https://cosbrowser.com/release/coscli/latest/linux/coscli && chmod +x /usr/local/bin/coscli
# ============================================================
set -euo pipefail

# -------- 配置 --------
BUCKET_NAME="cg-resource-hub-data-$(date +%s)"   # 改成你自己想要的桶名(全局唯一)
BUCKET_REGION="ap-guangzhou"                     # 改成桶所在地域(轻量服务器所在地域)
DATA_SRC="/path/to/cg-resource-hub/data"         # 改成服务器上 data/ 的实际路径
SECRET_ID="<your-secret-id>"                     # 在 https://console.cloud.tencent.com/cam/capi 拿
SECRET_KEY="<your-secret-key>"                   # 同上
# --------------------

# 1. 创建桶(忽略已存在错误)
coscli mb cos://${BUCKET_NAME} --region ${BUCKET_REGION} 2>/dev/null || true

# 2. 同步数据(并发 8,断点续传)
coscli cp ${DATA_SRC}/ cos://${BUCKET_NAME}/data/ \
    --recursive --workers 8 --rate-limiting 50

# 3. 把 data/ 软链到挂载目录(用 goofys 或 cosfs 把 COS 挂回本地)
#    先装: apt-get install -y fuse
#    然后: wget -O /usr/local/bin/goofys https://github.com/kahing/goofys/releases/latest/download/goofys && chmod +x /usr/local/bin/goofys
mkdir -p /mnt/cos-data
cat > /etc/passwd-cosfs <<EOF
${BUCKET_NAME}:${SECRET_ID}:${SECRET_KEY}
EOF
chmod 640 /etc/passwd-cosfs

# 挂载(替换原有 data 目录)
if mountpoint -q /mnt/cos-data; then
    echo "COS already mounted"
else
    goofys --region ${BUCKET_REGION} ${BUCKET_NAME} /mnt/cos-data
fi

# 4. 把项目里的 data 替换为软链
rm -rf ${DATA_SRC}
ln -s /mnt/cos-data ${DATA_SRC}
ls -la ${DATA_SRC}/ | head -5
echo "DONE: data/ 已指向 /mnt/cos-data,实际数据在 COS 桶 ${BUCKET_NAME}"