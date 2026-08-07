object HOSxPPCUAccount2ClassifyingListFrame: THOSxPPCUAccount2ClassifyingListFrame
  Left = 0
  Top = 0
  Width = 916
  Height = 655
  Font.Charset = DEFAULT_CHARSET
  Font.Color = clWindowText
  Font.Height = -13
  Font.Name = 'Tahoma'
  Font.Style = []
  ParentFont = False
  TabOrder = 0
  object dxLayoutControl1: TdxLayoutControl
    Left = 0
    Top = 0
    Width = 916
    Height = 655
    Align = alClient
    TabOrder = 0
    LayoutLookAndFeel = dxLayoutSkinLookAndFeel1
    object cxGroupBox3: TcxGroupBox
      Left = 0
      Top = 390
      Caption = #3611#3619#3632#3623#3633#3605#3636#3607#3634#3591#3629#3634#3618#3640#3619#3585#3619#3619#3617
      TabOrder = 2
      Height = 204
      Width = 916
      object cxGrid3: TcxGrid
        Left = 2
        Top = 21
        Width = 912
        Height = 181
        Align = alClient
        TabOrder = 0
        object cxGridDBTableView2: TcxGridDBTableView
          Navigator.Buttons.CustomButtons = <>
          ScrollbarAnnotations.CustomAnnotations = <>
          DataController.DataSource = PersonANCClassifying3DS
          DataController.Summary.DefaultGroupSummaryItems = <>
          DataController.Summary.FooterSummaryItems = <>
          DataController.Summary.SummaryGroups = <>
          OptionsData.Deleting = False
          OptionsData.Inserting = False
          OptionsView.GroupByBox = False
          OptionsView.Indicator = True
          object cxGridDBColumn4: TcxGridDBColumn
            Caption = #3621#3635#3604#3633#3610
            OnGetDisplayText = cxGridDBColumn4GetDisplayText
            Options.Editing = False
            Options.Focusing = False
            Width = 48
          end
          object cxGridDBColumn5: TcxGridDBColumn
            Caption = #3619#3634#3618#3585#3634#3619#3588#3623#3634#3617#3648#3626#3637#3656#3618#3591
            DataBinding.FieldName = 'person_anc_classifying_item_id'
            PropertiesClassName = 'TcxLookupComboBoxProperties'
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'person_anc_classifying_item_id'
            Properties.ListColumns = <
              item
                FieldName = 'person_anc_classifying_item_name'
              end>
            Properties.ListSource = PersonANCClassifyingItemDS
            Options.Editing = False
            Options.Focusing = False
            Width = 493
          end
          object cxGridDBColumn6: TcxGridDBColumn
            Caption = #3614#3610'/'#3617#3637
            DataBinding.FieldName = 'check_value'
            PropertiesClassName = 'TcxCheckBoxProperties'
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            Width = 49
          end
        end
        object cxGridLevel2: TcxGridLevel
          GridView = cxGridDBTableView2
        end
      end
    end
    object cxGroupBox1: TcxGroupBox
      Left = 0
      Top = 0
      Caption = #3611#3619#3632#3623#3633#3605#3636#3629#3604#3637#3605
      TabOrder = 0
      Height = 186
      Width = 916
      object cxGrid1: TcxGrid
        Left = 2
        Top = 21
        Width = 912
        Height = 163
        Align = alClient
        TabOrder = 0
        object cxGrid1DBTableView1: TcxGridDBTableView
          Navigator.Buttons.CustomButtons = <>
          ScrollbarAnnotations.CustomAnnotations = <>
          DataController.DataSource = PersonANCClassifying1DS
          DataController.Summary.DefaultGroupSummaryItems = <>
          DataController.Summary.FooterSummaryItems = <>
          DataController.Summary.SummaryGroups = <>
          OptionsData.Deleting = False
          OptionsData.Inserting = False
          OptionsView.GroupByBox = False
          OptionsView.Indicator = True
          object cxGrid1DBTableView1Column1: TcxGridDBColumn
            Caption = #3621#3635#3604#3633#3610
            OnGetDisplayText = cxGrid3DBTableView1Column1GetDisplayText
            Options.Editing = False
            Options.Focusing = False
            Width = 48
          end
          object cxGrid1DBTableView1Column2: TcxGridDBColumn
            Caption = #3619#3634#3618#3585#3634#3619#3588#3623#3634#3617#3648#3626#3637#3656#3618#3591
            DataBinding.FieldName = 'person_anc_classifying_item_id'
            PropertiesClassName = 'TcxLookupComboBoxProperties'
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'person_anc_classifying_item_id'
            Properties.ListColumns = <
              item
                FieldName = 'person_anc_classifying_item_name'
              end>
            Properties.ListSource = PersonANCClassifyingItemDS
            Options.Editing = False
            Options.Focusing = False
            Width = 493
          end
          object cxGrid1DBTableView1Column3: TcxGridDBColumn
            Caption = #3614#3610'/'#3617#3637
            DataBinding.FieldName = 'check_value'
            PropertiesClassName = 'TcxCheckBoxProperties'
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            Width = 49
          end
        end
        object cxGrid1Level1: TcxGridLevel
          GridView = cxGrid1DBTableView1
        end
      end
    end
    object cxGroupBox2: TcxGroupBox
      Left = 0
      Top = 186
      Caption = #3611#3619#3632#3623#3633#3605#3636#3588#3619#3619#3616#3660#3611#3633#3592#3592#3640#3610#3633#3609
      TabOrder = 1
      Height = 204
      Width = 916
      object cxGrid2: TcxGrid
        Left = 2
        Top = 21
        Width = 912
        Height = 181
        Align = alClient
        TabOrder = 0
        object cxGridDBTableView1: TcxGridDBTableView
          Navigator.Buttons.CustomButtons = <>
          ScrollbarAnnotations.CustomAnnotations = <>
          DataController.DataSource = PersonANCClassifying2DS
          DataController.Summary.DefaultGroupSummaryItems = <>
          DataController.Summary.FooterSummaryItems = <>
          DataController.Summary.SummaryGroups = <>
          OptionsData.Deleting = False
          OptionsData.Inserting = False
          OptionsView.GroupByBox = False
          OptionsView.Indicator = True
          object cxGridDBColumn1: TcxGridDBColumn
            Caption = #3621#3635#3604#3633#3610
            OnGetDisplayText = cxGridDBColumn4GetDisplayText
            Options.Editing = False
            Options.Focusing = False
            Width = 48
          end
          object cxGridDBColumn2: TcxGridDBColumn
            Caption = #3619#3634#3618#3585#3634#3619#3588#3623#3634#3617#3648#3626#3637#3656#3618#3591
            DataBinding.FieldName = 'person_anc_classifying_item_id'
            PropertiesClassName = 'TcxLookupComboBoxProperties'
            Properties.IncrementalFilteringOptions = [ifoHighlightSearchText, ifoUseContainsOperator]
            Properties.KeyFieldNames = 'person_anc_classifying_item_id'
            Properties.ListColumns = <
              item
                FieldName = 'person_anc_classifying_item_name'
              end>
            Properties.ListSource = PersonANCClassifyingItemDS
            Options.Editing = False
            Options.Focusing = False
            Width = 493
          end
          object cxGridDBColumn3: TcxGridDBColumn
            Caption = #3614#3610'/'#3617#3637
            DataBinding.FieldName = 'check_value'
            PropertiesClassName = 'TcxCheckBoxProperties'
            Properties.NullStyle = nssUnchecked
            Properties.ValueChecked = 'Y'
            Properties.ValueUnchecked = 'N'
            Width = 49
          end
        end
        object cxGridLevel1: TcxGridLevel
          GridView = cxGridDBTableView1
        end
      end
    end
    object dxLayoutControl1Group_Root: TdxLayoutGroup
      AlignHorz = ahClient
      AlignVert = avTop
      ButtonOptions.Buttons = <>
      Hidden = True
      ItemIndex = 1
      ShowBorder = False
      Index = -1
    end
    object dxLayoutControl1Item3: TdxLayoutItem
      Parent = dxLayoutControl1Group_Root
      CaptionOptions.Visible = False
      Control = cxGroupBox3
      ControlOptions.AutoColor = True
      ControlOptions.OriginalHeight = 204
      ControlOptions.OriginalWidth = 718
      ControlOptions.ShowBorder = False
      Index = 2
    end
    object dxLayoutControl1Item1: TdxLayoutItem
      Parent = dxLayoutControl1Group_Root
      CaptionOptions.Visible = False
      Control = cxGroupBox1
      ControlOptions.AutoColor = True
      ControlOptions.OriginalHeight = 186
      ControlOptions.OriginalWidth = 718
      ControlOptions.ShowBorder = False
      Index = 0
    end
    object dxLayoutControl1Item2: TdxLayoutItem
      Parent = dxLayoutControl1Group_Root
      CaptionOptions.Visible = False
      Control = cxGroupBox2
      ControlOptions.AutoColor = True
      ControlOptions.OriginalHeight = 204
      ControlOptions.OriginalWidth = 718
      ControlOptions.ShowBorder = False
      Index = 1
    end
  end
  object PersonANCClassifying1CDS: TClientDataSet
    Active = True
    Aggregates = <>
    Params = <>
    BeforePost = PersonANCClassifying1CDSBeforePost
    Left = 144
    Top = 126
    Data = {
      080200009619E0BD010000001800000005000000000003000000080219706572
      736F6E5F616E635F636C617373696679696E675F696404000100000002000950
      524F56464C4147530400018007000000064F524947494E020049803100706572
      736F6E5F616E635F636C617373696679696E672E706572736F6E5F616E635F63
      6C617373696679696E675F6964000D706572736F6E5F616E635F696404000100
      00000100064F524947494E020049802500706572736F6E5F616E635F636C6173
      73696679696E672E706572736F6E5F616E635F6964001E706572736F6E5F616E
      635F636C617373696679696E675F6974656D5F69640400010000000100064F52
      4947494E020049803600706572736F6E5F616E635F636C617373696679696E67
      2E706572736F6E5F616E635F636C617373696679696E675F6974656D5F696400
      0B636865636B5F76616C75650100490000000300075355425459504502004900
      0A0046697865644368617200055749445448020002000100064F524947494E02
      0049802300706572736F6E5F616E635F636C617373696679696E672E63686563
      6B5F76616C7565000F7570646174655F6461746574696D650800080000000100
      064F524947494E020049802700706572736F6E5F616E635F636C617373696679
      696E672E7570646174655F6461746574696D650001000B5052494D4152595F4B
      455902008200010000000100}
  end
  object PersonANCClassifying1DS: TDataSource
    DataSet = PersonANCClassifying1CDS
    Left = 282
    Top = 132
  end
  object PersonANCClassifying2CDS: TClientDataSet
    Active = True
    Aggregates = <>
    Params = <>
    BeforePost = PersonANCClassifying1CDSBeforePost
    Left = 138
    Top = 228
    Data = {
      080200009619E0BD010000001800000005000000000003000000080219706572
      736F6E5F616E635F636C617373696679696E675F696404000100000002000950
      524F56464C4147530400018007000000064F524947494E020049803100706572
      736F6E5F616E635F636C617373696679696E672E706572736F6E5F616E635F63
      6C617373696679696E675F6964000D706572736F6E5F616E635F696404000100
      00000100064F524947494E020049802500706572736F6E5F616E635F636C6173
      73696679696E672E706572736F6E5F616E635F6964001E706572736F6E5F616E
      635F636C617373696679696E675F6974656D5F69640400010000000100064F52
      4947494E020049803600706572736F6E5F616E635F636C617373696679696E67
      2E706572736F6E5F616E635F636C617373696679696E675F6974656D5F696400
      0B636865636B5F76616C75650100490000000300075355425459504502004900
      0A0046697865644368617200055749445448020002000100064F524947494E02
      0049802300706572736F6E5F616E635F636C617373696679696E672E63686563
      6B5F76616C7565000F7570646174655F6461746574696D650800080000000100
      064F524947494E020049802700706572736F6E5F616E635F636C617373696679
      696E672E7570646174655F6461746574696D650001000B5052494D4152595F4B
      455902008200010000000100}
  end
  object PersonANCClassifying2DS: TDataSource
    DataSet = PersonANCClassifying2CDS
    Left = 282
    Top = 231
  end
  object PersonANCClassifying3CDS: TClientDataSet
    Active = True
    Aggregates = <>
    Params = <>
    BeforePost = PersonANCClassifying1CDSBeforePost
    Left = 141
    Top = 345
    Data = {
      080200009619E0BD010000001800000005000000000003000000080219706572
      736F6E5F616E635F636C617373696679696E675F696404000100000002000950
      524F56464C4147530400018007000000064F524947494E020049803100706572
      736F6E5F616E635F636C617373696679696E672E706572736F6E5F616E635F63
      6C617373696679696E675F6964000D706572736F6E5F616E635F696404000100
      00000100064F524947494E020049802500706572736F6E5F616E635F636C6173
      73696679696E672E706572736F6E5F616E635F6964001E706572736F6E5F616E
      635F636C617373696679696E675F6974656D5F69640400010000000100064F52
      4947494E020049803600706572736F6E5F616E635F636C617373696679696E67
      2E706572736F6E5F616E635F636C617373696679696E675F6974656D5F696400
      0B636865636B5F76616C75650100490000000300075355425459504502004900
      0A0046697865644368617200055749445448020002000100064F524947494E02
      0049802300706572736F6E5F616E635F636C617373696679696E672E63686563
      6B5F76616C7565000F7570646174655F6461746574696D650800080000000100
      064F524947494E020049802700706572736F6E5F616E635F636C617373696679
      696E672E7570646174655F6461746574696D650001000B5052494D4152595F4B
      455902008200010000000100}
  end
  object PersonANCClassifying3DS: TDataSource
    DataSet = PersonANCClassifying3CDS
    Left = 294
    Top = 342
  end
  object PersonANCClassifyingItemCDS: TClientDataSet
    Aggregates = <>
    Params = <>
    Left = 402
    Top = 262
  end
  object PersonANCClassifyingItemDS: TDataSource
    DataSet = PersonANCClassifyingItemCDS
    Left = 570
    Top = 258
  end
  object dxLayoutLookAndFeelList1: TdxLayoutLookAndFeelList
    Left = 54
    Top = 37
    object dxLayoutSkinLookAndFeel1: TdxLayoutSkinLookAndFeel
      Offsets.ControlOffsetHorz = 0
      Offsets.ControlOffsetVert = 0
      Offsets.ItemOffset = 0
      Offsets.RootItemsAreaOffsetHorz = 0
      Offsets.RootItemsAreaOffsetVert = 0
      PixelsPerInch = 96
    end
  end
end
