import { BadRequestException, Injectable, Res } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Response } from 'express'
import { Model } from 'mongoose'
import { ParamIdDto, QueryDto } from 'src/_shared/query.dto'
import { CustomRequest, PaginationResponse } from 'src/_shared/response'
import { formatTimestamp } from 'src/_shared/utils/utils'
import * as XLSX from 'xlsx'
import { Basedata } from './Schema/Basedatas'
import { BasedataQueryDto } from './dto/basedata.query.dto'
import { UpdateBasedatumDto } from './dto/update-basedatum.dto'
import { Device } from 'src/devices/Schema/Device'
import { CreateBasedatumDto } from './dto/create-basedatum.dto'
import { getDataFromDevice } from 'src/_shared/utils/passport.utils'

@Injectable()
export class BasedataService {
  constructor (
    @InjectModel(Basedata.name) private basedataModel: Model<Basedata>,
    @InjectModel(Device.name) private deviceModel: Model<Device>
  ) {}
  async create (createBasedata: CreateBasedatumDto) {
    const {_id} =  await this.deviceModel.findOne({
      serie: createBasedata.serie,
    })
    if (!_id) {
      throw new BadRequestException({ msg: 'Device not found!' })
    }
    const deviceLevel = createBasedata.level > 59 ? 59  : createBasedata.level < 5 ? 5 : createBasedata.level
    console.log(deviceLevel);
    const date_in_ms = new Date().getTime()
    const signal  =  deviceLevel ? "good" :"nosignal"
    const { level, volume, pressure } = await getDataFromDevice(
      deviceLevel,
      createBasedata.serie ,
    )
    this.basedataModel.create({ date_in_ms , signal , level ,device :_id , volume ,pressure  })
   return  { msg: 'Malumot saqlandi!' }
  }










  // ! Barcha ma'lumotlarni olish uchun
  async findAll ({
    page,
    filter,
    sort,
  }: BasedataQueryDto): Promise<PaginationResponse<Basedata>> {
    const { limit = 10, offset = 0 } = page || {}
    const { by = 'created_at', order = 'desc' } = sort || {}
    const { start, end, device, region } = filter || {}
    const query: any = {}
    if (start) {
      query.date_in_ms = query.date_in_ms || {}
      query.date_in_ms.$gte = start
    }
    if (end) {
      query.date_in_ms = query.date_in_ms || {}
      query.date_in_ms.$lte = end
    }
    if (device) {
      query.device = device
    }
    if (!device && region) {
      const devices = await this.deviceModel.find({ region }).lean()
      const devices_id = devices.map(device => device._id)
      query.device = { $in: devices_id }
    }
    const total = await this.basedataModel.find({ ...query }).countDocuments()
    const data = await this.basedataModel
      .find({ ...query })
      .sort({ [by]: order === 'desc' ? -1 : 1 })
      .populate([{ path: 'device', select: 'serie' }])
      .limit(limit)
      .skip(limit * offset)
    return { data, limit, offset, total }
  }

  async lastData ({ page }: QueryDto) {
    const { limit = 10, offset = 0 } = page || {}
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000) // Subtract one hour from the current time

    const data = this.basedataModel
      .find({
        createdAt: { $gte: oneHourAgo },
      })
      .limit(limit)
      .skip(limit * offset)
      .exec()
    return data
  }

  // ! operator devices
  async operatorDeviceBaseData (
    { page, filter, sort }: BasedataQueryDto,
    req: CustomRequest
  ) {
    const { limit = 10, offset = 0 } = page || {}
    const { by = 'created_at', order = 'desc' } = sort || {}
    const { start, end, device } = filter || {}
    const query: any = {}
    if (start) {
      query.date_in_ms = query.date_in_ms || {}
      query.date_in_ms.$gte = start
    }
    if (end) {
      query.date_in_ms = query.date_in_ms || {}
      query.date_in_ms.$lte = end
    }
    if (device) {
      query.device = device
    }
    const owner = req.user.id
    const devices = await this.deviceModel.find({ owner }).lean()
    const devices_id = devices.map(device => device._id)
    const total = await this.basedataModel
      .find({ device: { $in: devices_id }, ...query })
      .countDocuments()
    const data = await this.basedataModel
      .find({
        device: { $in: devices_id },
        ...query,
      })
      .sort({ [by]: order === 'desc' ? -1 : 1 })
      .populate([{ path: 'device', select: 'serie' }])
      .limit(limit)
      .skip(limit * offset)
      .exec()
    return { data, limit, offset, total }
  }

  //! Bitta qurilma ma'lumotlarini olish uchun
  async findOneDevice (
    { page }: QueryDto,
    { id }: ParamIdDto
  ): Promise<PaginationResponse<Basedata>> {
    const { limit = 10, offset = 0 } = page || {}

    const total = await this.basedataModel.find({ device: id }).countDocuments()
    const data = await this.basedataModel
      .find({ device: id })
      .populate([{ path: 'device', select: 'serie  ' }])
      .limit(limit)
      .skip(limit * offset)
    return { data, limit, offset, total }
  }

  //! Bitta malumotni olish uchun
  findOne ({ id }: ParamIdDto) {
    return this.basedataModel.findById(id)
  }

  // ! Bitta mal'lumotni yangilash uchun
  async update ({ id }: ParamIdDto, updateBasedatumDto: UpdateBasedatumDto) {
    const updated = await this.basedataModel.findByIdAndUpdate(
      id,
      updateBasedatumDto,
      { new: true }
    )
    if (updated) {
      return { msg: 'Muvaffaqqiyatli yangilandi!' }
    } else {
      return { msg: 'Yangilanishda xatolik!' }
    }
  }

  //! Bitta mal'lumotni o'chirish uchun
  async remove ({ id }: ParamIdDto) {
    const removed = await this.basedataModel.findByIdAndDelete(id, {
      new: true,
    })
    if (removed) {
      return { msg: "Muvaffaqqiyatli o'chirildi!" }
    } else {
      return { msg: "O'chirilsihda xatolik!" }
    }
  }

  async xlsx ({ filter, page }: BasedataQueryDto, @Res() res: Response) {
    const { start, end, device, region } = filter || {}
    const { limit = 1000 } = page || {}
    const query: any = {}
    if (start) {
      query.date_in_ms = query.date_in_ms || {}
      query.date_in_ms.$gte = start
    }
    if (end) {
      query.date_in_ms = query.date_in_ms || {}
      query.date_in_ms.$lte = end
    }
    if (device) {
      query.device = device
    }
    if (!device && region) {
      const devices = await this.deviceModel.find({ region }).lean()
      const devices_id = devices.map(device => device._id)
      query.device = { $in: devices_id }
    }
    const data = await this.basedataModel
      .find({ ...query })
      .sort({ created_at: -1 })
      .populate([{ path: 'device', select: 'serie' }])
      .limit(limit)
      .exec()
    const jsonData = data.map((item: any) => {
      const obj = item.toObject()
      obj._id = item?._id?.toString()
      obj.device = item?.device?.serie
      obj.date_in_ms = formatTimestamp(item?.date_in_ms)
      return obj
    })
    const ws = XLSX.utils.json_to_sheet(jsonData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'DataSheet')
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
    res.setHeader('Content-Disposition', 'attachment; filename=basedata.xlsx')
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    res.send(excelBuffer)
  }
}
