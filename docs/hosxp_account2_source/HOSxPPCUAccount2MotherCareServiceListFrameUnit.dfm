object HOSxPPCUAccount2MotherCareServiceListFrame: THOSxPPCUAccount2MotherCareServiceListFrame
  Left = 0
  Top = 0
  Width = 845
  Height = 652
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -13
  Font.Name = 'Tahoma'
  Font.Style = []
  ParentFont = False
  TabOrder = 0
  object cxGrid4: TcxGrid
    Left = 0
    Top = 65
    Width = 845
    Height = 587
    Align = alClient
    TabOrder = 0
    object cxGrid4DBTableView1: TcxGridDBTableView
      Navigator.Buttons.CustomButtons = <>
      Navigator.Visible = True
      ScrollbarAnnotations.CustomAnnotations = <>
      DataController.DataSource = PersonANCPregCareDS
      DataController.Summary.DefaultGroupSummaryItems = <>
      DataController.Summary.FooterSummaryItems = <>
      DataController.Summary.SummaryGroups = <>
      OptionsData.CancelOnExit = False
      OptionsData.Deleting = False
      OptionsData.DeletingConfirmation = False
      OptionsData.Editing = False
      OptionsData.Inserting = False
      OptionsSelection.CellSelect = False
      OptionsView.GroupByBox = False
      OptionsView.Indicator = True
      object cxGrid4DBTableView1Column1: TcxGridDBColumn
        Caption = #3588#3619#3633#3657#3591#3607#3637#3656
        DataBinding.FieldName = 'preg_care_number'
        OnGetDisplayText = cxGrid4DBTableView1Column1GetDisplayText
        Width = 44
      end
      object cxGrid4DBTableView1care_date: TcxGridDBColumn
        Caption = #3623#3633#3609#3607#3637#3656
        DataBinding.FieldName = 'care_date'
        Width = 98
      end
      object cxGrid4DBTableView1anc_preg_care_location_id: TcxGridDBColumn
        Caption = #3626#3606#3634#3609#3607#3637#3656
        DataBinding.FieldName = 'anc_preg_care_location_id'
        PropertiesClassName = 'TcxLookupComboBoxProperties'
        Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
        Properties.KeyFieldNames = 'anc_preg_care_location_id'
        Properties.ListColumns = <
          item
            FieldName = 'anc_preg_care_location_name'
          end>
        Properties.ListSource = HOSxPPCUAccount2DataModule.ANCPregCareLocationDS
        Width = 103
      end
      object cxGrid4DBTableView1bps: TcxGridDBColumn
        Caption = #3588#3623#3634#3617#3604#3633#3609' (systolic)'
        DataBinding.FieldName = 'bps'
        Width = 72
      end
      object cxGrid4DBTableView1bpd: TcxGridDBColumn
        Caption = #3588#3623#3634#3617#3604#3633#3609' (diastolic)'
        DataBinding.FieldName = 'bpd'
        Width = 71
      end
      object cxGrid4DBTableView1rr: TcxGridDBColumn
        Caption = #3629#3633#3605#3619#3634#3627#3634#3618#3651#3592
        DataBinding.FieldName = 'rr'
        Width = 80
      end
      object cxGrid4DBTableView1temperature: TcxGridDBColumn
        Caption = #3629#3640#3603#3627#3616#3641#3617#3636
        DataBinding.FieldName = 'temperature'
        Width = 58
      end
      object cxGrid4DBTableView1Column2: TcxGridDBColumn
        DataBinding.FieldName = 'hr'
        PropertiesClassName = 'TcxTextEditProperties'
        Properties.Alignment.Horz = taCenter
      end
      object cxGrid4DBTableView1Column3: TcxGridDBColumn
        DataBinding.FieldName = 'pulse'
        PropertiesClassName = 'TcxTextEditProperties'
        Properties.Alignment.Horz = taCenter
      end
      object cxGrid4DBTableView1uterus_level_normal: TcxGridDBColumn
        Caption = #3619#3632#3604#3633#3610#3617#3604#3621#3641#3585#3611#3585#3605#3636
        DataBinding.FieldName = 'uterus_level_normal'
        Width = 85
      end
      object cxGrid4DBTableView1lochia_normal: TcxGridDBColumn
        Caption = #3609#3657#3635#3588#3634#3623#3611#3621#3634#3611#3585#3605#3636
        DataBinding.FieldName = 'lochia_normal'
        Width = 83
      end
      object cxGrid4DBTableView1nipple_normal: TcxGridDBColumn
        Caption = #3627#3633#3623#3609#3617#3611#3585#3605#3636
        DataBinding.FieldName = 'nipple_normal'
        Width = 66
      end
      object cxGrid4DBTableView1perineum_normal: TcxGridDBColumn
        Caption = #3613#3637#3648#3618#3655#3610#3611#3585#3605#3636
        DataBinding.FieldName = 'perineum_normal'
        Width = 58
      end
      object cxGrid4DBTableView1albumin_level: TcxGridDBColumn
        Caption = 'Albumin'
        DataBinding.FieldName = 'albumin_level'
        Width = 74
      end
      object cxGrid4DBTableView1sugar_level: TcxGridDBColumn
        Caption = 'Sugar'
        DataBinding.FieldName = 'sugar_level'
        Width = 71
      end
      object cxGrid4DBTableView1advice_text: TcxGridDBColumn
        Caption = #3588#3635#3649#3609#3632#3609#3635
        DataBinding.FieldName = 'advice_text'
        Width = 170
      end
    end
    object cxGrid4Level1: TcxGridLevel
      GridView = cxGrid4DBTableView1
    end
  end
  object cxGroupBox1: TcxGroupBox
    Left = 0
    Top = 0
    Align = alTop
    Caption = 'Task'
    TabOrder = 1
    Height = 65
    Width = 845
    object cxButton7: TcxButton
      Left = 156
      Top = 25
      Width = 153
      Height = 25
      Caption = #3649#3585#3657#3652#3586#3585#3634#3619#3605#3619#3623#3592#3627#3621#3633#3591#3588#3621#3629#3604
      TabOrder = 0
      OnClick = cxButton7Click
    end
    object cxButton13: TcxButton
      Left = 10
      Top = 25
      Width = 140
      Height = 25
      Caption = #3610#3633#3609#3607#3638#3585#3585#3634#3619#3605#3619#3623#3592#3627#3621#3633#3591#3588#3621#3629#3604
      TabOrder = 1
      OnClick = cxButton13Click
    end
  end
  object PersonANCPregCareCDS: TClientDataSet
    Active = True
    Aggregates = <>
    Params = <>
    Left = 552
    Top = 9
    Data = {
      9C0100009619E0BD01000000180000000F0000000000030000009C0117706572
      736F6E5F616E635F707265675F636172655F696404000100000000000D706572
      736F6E5F616E635F6964040001000000000009636172655F6461746504000600
      0000000019616E635F707265675F636172655F6C6F636174696F6E5F69640400
      010000000000137574657275735F6C6576656C5F6E6F726D616C010049000000
      01000557494454480200020001000D6C6F636869615F6E6F726D616C01004900
      000001000557494454480200020001000D6E6970706C655F6E6F726D616C0100
      4900000001000557494454480200020001000D616C62756D696E5F6C6576656C
      08000400000000000B73756761725F6C6576656C08000400000000000B616476
      6963655F7465787404004B000000010007535542545950450200490005005465
      7874000F706572696E65756D5F6E6F726D616C01004900000001000557494454
      4802000200010003627073080004000000000003627064080004000000000002
      727208000400000000000B74656D706572617475726508000400000000000000}
  end
  object PersonANCPregCareDS: TDataSource
    DataSet = PersonANCPregCareCDS
    Left = 633
    Top = 9
  end
end
