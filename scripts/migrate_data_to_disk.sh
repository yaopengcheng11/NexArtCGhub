#!/usr/bin/env bash
# ============================================================
# 把 data/tools_uploads/ 迁移到独立云盘(用户上传临时区)
# 注意: 本项目真正的资源走百度网盘,服务器不存大文件;
#       只有 data/tools_uploads/(在线工具上传的 .hip/.zip)需要单独挂盘。
# 前提: 已在腾讯云控制台给本实例挂载了一块数据盘(/dev/vdb)
# ============================================================
set -euo pipefail

# -------- 配置 --------
DATA_DISK_DEV="/dev/vdb"           # 数据盘设备名(以 fdisk -l 为准)
MOUNT_POINT="/mnt/data"
DATA_SRC="/path/to/cg-resource-hub/data"   # 项目里 data/ 的实际路径
# --------------------

# 1. 格式化(仅第一次,二次跑会丢数据!)
if ! blkid ${DATA_DISK_DEV} | grep -q ext4; then
    mkfs.ext4 ${DATA_DISK_DEV}
fi

# 2. 挂载
mkdir -p ${MOUNT_POINT}
mount ${DATA_DISK_DEV} ${MOUNT_POINT}

# 3. 写 fstab 让重启自动挂载
UUID=$(blkid -s UUID -o value ${DATA_DISK_DEV})
echo "UUID=${UUID} ${MOUNT_POINT} ext4 defaults,nofail 0 2" >> /etc/fstab

# 4. 迁移数据(用 rsync 保留权限)
rsync -avP ${DATA_SRC}/ ${MOUNT_POINT}/
echo "迁移完成,共 $(du -sh ${MOUNT_POINT} | awk '{print $1}')"

# 5. 把 data 换成软链(保留目录结构,改路径对项目透明)
rm -rf ${DATA_SRC}
ln -s ${MOUNT_POINT} ${DATA_SRC}

# 6. 验证
df -h ${MOUNT_POINT}
ls -la ${DATA_SRC}/ | head -5
echo "DONE: data/ 已指向 ${MOUNT_POINT}"